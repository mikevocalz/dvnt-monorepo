#!/usr/bin/env node
/** Production web panel behavior. DOM adapters only; not browser/device acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const paths = [ROOT, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = name => require.resolve(name, { paths });

(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window({ url: 'https://fixture.invalid', settings: { enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true } });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-panels-'));
  try {
    await require(resolve('esbuild')).build({
      stdin: { resolveDir: ROOT, loader: 'tsx', contents: `
        import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
        import * as panels from './packages/app/features/sneaky-lynk/ui/web/room-panels';
        export {React, act};
        export function mount(node) {const root=createRoot(node);return {
          render:(name,props)=>root.render(React.createElement(panels[name],props)),
          stack:open=>root.render(<><panels.SidePanel open={open[0]} onClose={()=>window.closedPanels.push('first')} title="First"><button>First action</button></panels.SidePanel><panels.SidePanel open={open[1]} onClose={()=>window.closedPanels.push('second')} title="Second"><button>Second action</button></panels.SidePanel></>),
          unmount:()=>root.unmount()
        };}
      ` },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, nodePaths: paths,
      alias: { '@dvnt/app': path.join(ROOT, 'packages/app'), react: path.dirname(resolve('react/package.json')), 'react-dom': path.dirname(resolve('react-dom/package.json')) },
      outfile: path.join(temp, 'fixture.cjs'),
    });
    const fixture = require(path.join(temp, 'fixture.cjs'));
    const node = document.createElement('div');
    document.body.append(node);
    const renderer = fixture.mount(node);
    const render = (name, props) => fixture.act(async () => renderer.render(name, props));
    const click = element => fixture.act(async () => { assert.ok(element); element.click(); });
    const change = (element, value) => fixture.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const submit = () => fixture.act(async () => node.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    const button = label => [...node.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
    const key = (element, key, shiftKey = false) => fixture.act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));

    await render('SquareAvatar', { uri: '/broken.png', name: 'Avery', size: 40 });
    await fixture.act(async () => node.querySelector('img').dispatchEvent(new window.Event('error')));
    assert.equal(node.querySelector('img'), null, 'failed image resolves to initials');
    assert.equal(node.querySelector('[role="img"]').getAttribute('aria-label'), 'Avery');
    assert.equal(node.textContent, 'A');
    await render('SquareAvatar', { uri: '/replacement.png', name: 'Avery', size: 40 });
    assert.equal(node.querySelector('img').getAttribute('src'), '/replacement.png', 'new avatar can recover after failure');
    assert.ok(node.querySelector('img').className.includes('rounded-xl'), 'square avatars use the design radius');

    const trigger = document.createElement('button'); trigger.textContent = 'Open panel'; document.body.append(trigger);
    const alreadyInert = document.createElement('div'); alreadyInert.inert = true; document.body.append(alreadyInert);
    trigger.focus();
    let closes = 0;
    const panelProps = { open: true, onClose: () => closes++, title: 'People', children: fixture.React.createElement('button', {}, 'Last action') };
    await render('SidePanel', panelProps);
    const dialog = node.querySelector('[role="dialog"]');
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'People');
    assert.equal(trigger.inert, true, 'background is inert, not just visually covered');
    assert.equal(document.activeElement, button('Close'));
    await key(button('Close'), 'Tab', true);
    assert.equal(document.activeElement, button('Last action'), 'backward tab wraps');
    await key(button('Last action'), 'Tab');
    assert.equal(document.activeElement, button('Close'), 'forward tab wraps');
    await key(button('Close'), 'Escape');
    assert.equal(closes, 1);
    await render('SidePanel', { ...panelProps, open: false });
    assert.equal(document.activeElement, trigger, 'closing restores the trigger');
    assert.equal(trigger.inert, false);
    assert.equal(alreadyInert.inert, true, 'existing inert state is preserved');

    window.closedPanels = [];
    await fixture.act(async () => renderer.stack([true, true]));
    const roots = [...node.querySelectorAll('[data-room-side-panel-root]')];
    assert.equal(roots[0].inert, true);
    assert.equal(roots[1].inert, false);
    await key(document.activeElement, 'Escape');
    assert.deepEqual(window.closedPanels, ['second'], 'only the top panel handles escape');
    await fixture.act(async () => renderer.stack([false, true]));
    assert.equal(trigger.inert, true, 'closing a lower panel keeps the room inert');
    await fixture.act(async () => renderer.stack([false, false]));
    assert.equal(trigger.inert, false, 'last panel restores background state');

    const chat = { open: true, onClose() {}, comments: [], currentUserId: 'me', roomId: 'one', onSend: async () => true };
    const chatRender = patch => { Object.assign(chat, patch); return render('ChatPanel', chat); };
    await chatRender({ loading: true });
    assert.match(node.textContent, /Opening chat/);
    assert.equal(node.querySelector('[role="log"]').getAttribute('aria-busy'), 'true');
    await chatRender({ loading: false, error: 'Connection lost' });
    assert.match(node.textContent, /Chat is unavailable/);
    assert.doesNotMatch(node.textContent, /Break the ice/);
    await chatRender({ error: null });
    assert.match(node.textContent, /visible to everyone in this Lynk/);
    assert.match(node.textContent, /Break the ice/);
    let attempts = 0;
    await chatRender({ onSend: async () => { attempts++; throw new Error('Network failed'); } });
    await change(node.querySelector('input'), 'Keep this draft');
    await submit();
    assert.equal(attempts, 1);
    assert.match(node.querySelector('[role="alert"]').textContent, /Message not sent/);
    assert.equal(node.querySelector('input').value, 'Keep this draft');
    assert.equal(button('Send message').disabled, false);
    await chatRender({ open: false });
    await chatRender({ open: true });
    assert.equal(node.querySelector('input').value, 'Keep this draft', 'close/reopen keeps the draft');

    let finish;
    await chatRender({ onSend: () => { attempts++; return new Promise(resolve => { finish = resolve; }); } });
    await submit(); await submit();
    assert.equal(attempts, 2, 'repeated submit does not duplicate a pending message');
    assert.equal(button('Send message').disabled, true);
    assert.match(node.textContent, /Sending message/);
    await change(node.querySelector('input'), 'My next thought');
    await fixture.act(async () => finish(true));
    assert.equal(node.querySelector('input').value, 'My next thought', 'successful send preserves edits made while pending');
    await chatRender({ open: false }); await chatRender({ open: true });
    assert.equal(node.querySelector('input').value, 'My next thought', 'unsent edits survive close/reopen');
    await chatRender({ currentUserId: 'other-user' });
    assert.equal(node.querySelector('input').value, '', 'account change clears another user’s draft');
    await change(node.querySelector('input'), 'Room one only');
    await chatRender({ roomId: 'two' });
    assert.equal(node.querySelector('input').value, '', 'room change clears another room’s draft');

    const author = { username: 'PrivateUser', displayName: 'Real Name', avatar: '/secret-avatar.png', isAnonymous: true, anonLabel: 'Anon 7' };
    const comment = (id, createdAt) => ({ id, authorId: 'member:7', author, body: 'Message ' + id, createdAt });
    await chatRender({ comments: [comment(1, '2026-11-07T10:00:00Z'), comment(2, '2026-11-07T10:01:00Z'), comment(3, '2026-11-07T10:10:00Z'), comment(4, 'invalid-date')] });
    assert.equal(node.querySelector('img[src="/secret-avatar.png"]'), null);
    assert.doesNotMatch(node.textContent, /Real Name|PrivateUser|Invalid Date/);
    assert.match(node.textContent, /Anon 7/);
    assert.equal(node.querySelectorAll('time[title]').length, 2, 'messages after a long gap get a new timestamp');
    const list = node.querySelector('[data-room-chat-messages]');
    Object.defineProperties(list, { scrollHeight: { get: () => 1000, configurable: true }, clientHeight: { get: () => 200, configurable: true } });
    await fixture.act(async () => { list.scrollTop = 100; list.dispatchEvent(new window.Event('scroll', { bubbles: true })); });
    await chatRender({ comments: chat.comments.slice(0, -1) });
    assert.equal(button('Jump to latest messages'), undefined, 'deletion is not a new-message event');
    await chatRender({ comments: [...chat.comments, comment(5, '2026-11-07T10:11:00Z')] });
    assert.ok(button('Jump to latest messages'), 'new incoming message offers explicit jump');
    assert.equal(list.scrollTop, 100, 'history is not pulled away');

    const member = (userId, patch = {}) => ({ userId, displayName: userId, role: 'participant', status: 'active', handRaised: false, ...patch });
    const members = [member('me', { role: 'host' }), member('guest', { ...author, handRaised: true }), member('left', { status: 'left' }), ...Array.from({ length: 8 }, (_, i) => member('Person ' + i, { role: i === 0 ? 'moderator' : 'listener' }))];
    const actions = [];
    const action = kind => userId => actions.push([kind, userId]);
    const participants = { open: true, onClose() {}, members, localUserId: 'me', onPromote: action('promote'), onDemote: action('demote'), onKick: action('kick'), onMute: action('mute'), onUnmute: action('unmute'), onMuteAll: action('all') };
    await render('ParticipantsPanel', participants);
    assert.match(node.textContent, /In the room · 10/);
    assert.doesNotMatch(node.textContent, /Real Name|PrivateUser/);
    assert.equal(node.querySelector('img[src="/secret-avatar.png"]'), null);
    assert.ok(button('Mute Anon 7'));
    assert.equal(button('Mute me'), undefined, 'self moderation stays unavailable');
    assert.equal(button('Mute left'), undefined, 'departed roster members stay unavailable');
    await click(button('Make Anon 7 a co-host'));
    assert.deepEqual(actions.at(-1), ['promote', 'guest']);
    await change(node.querySelector('input[type="search"]'), 'Real Name');
    assert.match(node.textContent, /No matching names/, 'search never indexes an anonymous real name');
    await click(button('Clear search'));
    await render('ParticipantsPanel', { ...participants, members: members.map(m => m.userId === 'me' ? { ...m, role: 'participant' } : m) });
    assert.equal(button('Mute Anon 7'), undefined, 'live demotion removes moderation');
    await render('ParticipantsPanel', { ...participants, members: members.map(m => m.userId === 'me' ? { ...m, role: 'moderator' } : m) });
    assert.equal(button('Remove Person 0 from the room'), undefined, 'moderator cannot remove another moderator');
    assert.equal(button('Make Anon 7 a co-host'), undefined, 'moderator cannot grant co-host');

    await render('HandQueuePanel', { open: true, onClose() {}, order: ['left', 'guest', 'guest'], members, onInviteToSpeak: action('invite'), onLowerHand: action('lower'), onLowerAll: action('clear') });
    assert.equal(node.querySelectorAll('ol > li').length, 2, 'queue deduplicates ids while preserving positions');
    assert.match(node.textContent, /1 person waiting to speak/);
    assert.match(node.textContent, /Left the room/);
    assert.equal(button('Make left a co-host'), undefined);
    assert.ok(button('Make Anon 7 a co-host'));
    assert.match(node.textContent, /help moderate this Lynk/, 'co-host authority is disclosed');
    assert.equal(node.querySelector('img[src="/secret-avatar.png"]'), null);
    await click(button('Make Anon 7 a co-host'));
    assert.deepEqual(actions.at(-1), ['invite', 'guest'], 'existing callback contract is preserved');
    await fixture.act(async () => renderer.unmount());
    console.log('PASS: web panels render privacy-safe avatars and search, clear co-host actions, resilient chat/drafts/history, and keyboard-isolated dialogs. DOM adapters only.');
  } finally {
    await window.happyDOM.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
