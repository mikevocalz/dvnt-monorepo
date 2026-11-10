/** Isolated production web/native notice and state contract; no live requests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = name => require.resolve(name, { paths: [root, ...deps] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'private-profile-ui-'));
const output = path.join(tmp, 'presentation.cjs');
const overlays = path.join(tmp, 'overlays.ts');
fs.writeFileSync(overlays, 'export const resetPostAccessOverlays = () => {};');
// Native platform hosts only are replaced; production notice/copy/helper are real.
const nativeHost = path.join(tmp, 'native.tsx');
fs.writeFileSync(nativeHost, `import React from 'react'; export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>; export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':undefined}>{children}</span>;`);
buildSync({
  stdin: { contents: `export { privateProfilePresentation } from './packages/app/lib/profile/private-profile'; export { PrivateProfileNotice as Web } from './packages/app/features/profile/private-profile-notice.web'; export { PrivateProfileNotice as Native } from './packages/app/features/profile/private-profile-notice'; export { resetFollowAccessCaches } from './packages/app/lib/hooks/reset-follow-access-caches'; export { QueryClient } from '@tanstack/react-query'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: output,
  nodePaths: deps,
  alias: { '@dvnt/app/lib/posts/revoke-post-overlays': overlays, '@dvnt/app': path.join(root, 'packages/app'), 'react-native': nativeHost, react: path.dirname(resolve('react/package.json')), 'react-dom': path.dirname(resolve('react-dom/package.json')) },
});
const ui = require(output);
process.on('exit', () => fs.rmSync(tmp, {recursive: true, force: true}));
test('private posts stay concealed until server-confirmed following, including pending/cancelled/error states', () => {
  for (const state of [undefined, false]) {
    assert.equal(ui.privateProfilePresentation({isPrivate:true,following:state}).locked, true);
    assert.equal(ui.privateProfilePresentation({isPrivate:true,following:state,requestPending:true}).locked, true);
  }
  assert.equal(ui.privateProfilePresentation({isPrivate:true,following:true}).locked, false);
  assert.equal(ui.privateProfilePresentation({isPrivate:true,isOwnProfile:true}).locked, false);
  assert.equal(ui.privateProfilePresentation({isPrivate:false,following:false}).locked, false);
});
test('private follow control describes requesting/cancelling rather than claiming a follow', () => {
  assert.equal(ui.privateProfilePresentation({isPrivate:true}).buttonLabel, 'Follow');
  assert.equal(ui.privateProfilePresentation({isPrivate:true,mutationPending:true,mutationAction:'follow'}).buttonLabel, 'Requesting…');
  assert.equal(ui.privateProfilePresentation({isPrivate:true,requestPending:true}).buttonLabel, 'Requested · Cancel');
  assert.equal(ui.privateProfilePresentation({isPrivate:true,requestPending:true,mutationPending:true,mutationAction:'unfollow'}).buttonLabel, 'Cancelling…');
  assert.equal(ui.privateProfilePresentation({isPrivate:true,following:true}).buttonLabel, 'Following');
  assert.equal(ui.privateProfilePresentation({isPrivate:false,mutationPending:true,mutationAction:'follow'}).buttonLabel, 'Following…');
});
for (const platform of ['Web','Native']) test(`${platform} actual notice explains private and pending state without media or ID-verification demands`, () => {
  const plain = ui.renderToStaticMarkup(ui.createElement(ui[platform]));
  const pending = ui.renderToStaticMarkup(ui.createElement(ui[platform], {pending:true}));
  assert.match(plain, /This account is private/);
  assert.match(plain, /Follow this account to request access to their posts/);
  assert.match(pending, /Your follow request is pending/);
  assert.doesNotMatch(plain+pending, /<img|<video|<iframe|verification|No posts yet/);
});
test('both actual profile screens put the locked notice ahead of the posts grid', () => {
  for (const name of ['packages/app/features/profile/user-profile.web.tsx','packages/app/features/routes/screens/(protected)/profile/[username].tsx']) {
    const src=fs.readFileSync(path.join(root,name),'utf8');
    assert.match(src,/privateProfile\.locked \? \(\s*<PrivateProfileNotice pending=\{requestPending\}/);
    assert.match(src,/\{privateProfile\.buttonLabel\}/);
  }
});

test('unfollow and privacy resets erase cached follower identities without removing public profile headers', async () => {
  const client = new ui.QueryClient();
  for (const list of ['followers','following']) client.setQueryData(['users',list,'2'], {secret:'previously-authorized'});
  client.setQueryData(['users','username','example'], {username:'example'});
  await ui.resetFollowAccessCaches(client,false);
  assert.equal(client.getQueryData(['users','followers','2']),undefined);
  assert.equal(client.getQueryData(['users','following','2']),undefined);
  assert.deepEqual(client.getQueryData(['users','username','example']),{username:'example'});
  client.clear();
});

test('public profile counts never count restricted follow identities', () => {
  for(const name of ['packages/app/lib/api/users.ts','apps/mobile/lib/api/users.ts']){
    const src=fs.readFileSync(path.join(root,name),'utf8');
    const helper=src.slice(src.indexOf('async function getLiveProfileCounts('),src.indexOf('export const usersApi'));
    assert.doesNotMatch(helper,/from\(DB\.follows\.table\)/);
    assert.match(helper,/from\(DB\.users\.table\)/);
    assert.match(helper,/DB\.users\.followersCount/);
  }
});
