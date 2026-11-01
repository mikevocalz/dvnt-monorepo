#!/usr/bin/env node
// Execute the actual native shared-content bubbles and their long-press wiring.
// Run: NODE_PATH=<directory containing typescript> node --test scripts/test-dm-reaction-native-input.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const variants = [
  { name: 'SharedPostBubble', file: 'shared-post-bubble', props: { sharedPost: { postId: '41', authorUsername: 'author', authorAvatar: '' } }, route: 'post:41' },
  { name: 'StoryReplyBubble', file: 'story-reply-bubble', props: { storyReply: { storyId: '41', storyUsername: 'author', isExpired: false }, replyText: 'Fixture' }, route: '/(protected)/story/41?username=author' },
  { name: 'StoryReplyBubble', file: 'story-reply-bubble', label: 'expired story', props: { storyReply: { storyId: '41', storyUsername: 'author', isExpired: true }, replyText: 'Fixture' }, route: '/(protected)/profile/author' },
  { name: 'EventShareBubble', file: 'event-share-bubble', props: { eventShare: { eventId: '41', eventTitle: 'Fixture event' } }, route: '/(protected)/events/41' },
];

function fixture(variant, onLongPress) {
  const file = path.join(ROOT, `packages/app/components/chat/${variant.file}.tsx`);
  const calls = [], exports = {};
  const jsx = (type, props) => ({ type, props: props || {} });
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useCallback: callback => callback };
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: styles => styles, hairlineWidth: 1 } };
      if (name === 'expo-router') return { useRouter: () => ({ push: route => calls.push(route) }) };
      if (name === '@tanstack/react-query') return { useQueryClient: () => ({}) };
      if (name.endsWith('/routes/post-routes')) return { navigateToPost: (_router, _client, id) => calls.push('post:' + id) };
      return new Proxy({}, { get: () => () => null });
    },
  }, { filename: file });
  const tree = exports[variant.name]({ ...variant.props, isOwnMessage: false, onLongPress });
  function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (node.type === 'Pressable') return node;
    return find(node.props?.children);
  }
  return { target: find(tree), calls };
}

for (const variant of variants) {
  test(`${variant.label || variant.name}: long press reaches the existing press target and normal tap still navigates`, () => {
    let count = 0;
    const callback = () => { count++; };
    const f = fixture(variant, callback);
    assert.ok(f.target, 'existing press target is retained');
    assert.equal(f.target.props.onLongPress, callback);
    assert.equal(f.target.props.delayLongPress, 400);
    f.target.props.onLongPress();
    assert.equal(count, 1);
    assert.deepEqual(f.calls, [], 'opening picker must not navigate');
    f.target.props.onPress();
    assert.deepEqual(f.calls, [variant.route]);
  });
  test(`${variant.label || variant.name}: callers omitting long press retain normal navigation`, () => {
    const f = fixture(variant);
    assert.equal(f.target.props.onLongPress, undefined);
    f.target.props.onPress();
    assert.deepEqual(f.calls, [variant.route]);
  });
}

test('native chat passes the selected message to each shared bubble long-press prop', () => {
  const file = path.join(ROOT, 'packages/app/features/routes/screens/(protected)/chat/[id].tsx');
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set();
  const expected = new Set(['SharedPostBubble', 'StoryReplyBubble', 'EventShareBubble', 'MediaMessage']);
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && expected.has(node.tagName.getText(ast))) {
      const attribute = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'onLongPress');
      assert.ok(attribute && attribute.initializer && ts.isJsxExpression(attribute.initializer), node.tagName.getText(ast) + ' handler');
      const item = { id: '41' }, calls = [], exports = {};
      const expression = attribute.initializer.expression.getText(ast);
      vm.runInNewContext(ts.transpileModule(`exports.callback = ${expression};`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, { exports, item, handleLongPressMessage: selected => calls.push(selected) });
      exports.callback();
      assert.equal(calls[0], item);
      found.add(node.tagName.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual([...found].sort(), [...expected].sort());
});

function mediaFixture(mediaList, onLongPress) {
  const file = path.join(ROOT, 'packages/app/features/routes/screens/(protected)/chat/[id].tsx');
  const exports = {}, opens = [];
  const jsx = (type, props) => ({ type, props: props || {} });
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8') + '\nexport { MediaMessage };', {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    exports, console,
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: x => x, absoluteFill: {} } };
      if (name.endsWith('/MediaLightbox')) return { MediaLightbox: Object.assign(() => {}, { Image: 'LightboxImage' }) };
      return new Proxy({}, { get: () => () => null });
    },
  }, { filename: file });
  const tree = exports.MediaMessage({ mediaList, onLongPress, onPress: media => opens.push(media) });
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    nodes.push(node); visit(node.props?.children);
  }
  visit(tree);
  return { nodes, opens };
}

for (const type of ['image', 'video']) {
  test(`native ${type} tile exposes reaction long press on its existing open target`, () => {
    let holds = 0;
    const media = { type, uri: 'https://fixture.invalid/media' };
    const callback = () => holds++;
    const f = mediaFixture([media], callback);
    const target = f.nodes.find(n => n.type === (type === 'image' ? 'LightboxImage' : 'Pressable'));
    assert.ok(target); assert.equal(target.props.onLongPress, callback); assert.equal(target.props.delayLongPress, 400);
    target.props.onLongPress(); assert.equal(holds, 1); assert.deepEqual(f.opens, []);
    if (type === 'video') { target.props.onPress(); assert.equal(f.opens[0], media); }
    else assert.equal(target.props.index, 0, 'image retains gallery index for tap-to-open');
  });
}

test('native media overflow overlay cannot intercept the last tile gestures', () => {
  const f = mediaFixture(Array.from({ length: 5 }, (_, i) => ({ type: 'image', uri: `https://fixture.invalid/${i}` })), () => {});
  const overlay = f.nodes.find(n => n.props?.style?.backgroundColor === 'rgba(0,0,0,0.55)');
  assert.ok(overlay); assert.equal(overlay.props.pointerEvents, 'none');
});

for (const hasAction of [false, true]) {
  test(`lightbox image preserves tap-to-open ${hasAction ? 'with' : 'without'} contextual action`, () => {
    const file = path.join(ROOT, 'packages/app/components/media/MediaLightbox.tsx');
    const exports = {}, opens = [];
    const jsx = (type, props) => ({ type, props: props || {} });
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { createContext: () => ({}), useContext: () => ({ open: index => opens.push(index) }), useCallback: x => x };
      if (name === 'react-native') return { Pressable: 'Pressable', StyleSheet: { create: x => x } };
      return new Proxy({}, { get: () => () => null });
    } }, { filename: file });
    let holds = 0;
    const action = hasAction ? () => holds++ : undefined;
    const tree = exports.MediaLightbox.Image({ index: 2, children: null, onLongPress: action, delayLongPress: hasAction ? 400 : undefined });
    assert.equal(tree.type, 'Pressable'); assert.equal(tree.props.onLongPress, action);
    if (hasAction) { tree.props.onLongPress(); assert.equal(holds, 1); assert.deepEqual(opens, []); assert.equal(tree.props.delayLongPress, 400); }
    tree.props.onPress(); assert.deepEqual(opens, [2]);
  });
}
