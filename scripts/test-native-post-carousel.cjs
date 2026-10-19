// Production React components; native media bridges are mocked, not decoded.
// Exercises actual carousel state, effect ordering, focus, foreground and source lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const directory = path.resolve(__dirname, '../packages/app/components/media');
  const active = new Set();
  const events = [];
  const nativeProps = new Map();
  const nativePlayers = new Map();
  const nativePairs = new Map();
  const scrollCommands = [];
  const images = new Map();
  const gifPlayers = new Map();
  const players = [];
  const appListeners = new Set();
  let focused = true;
  let onScroll;
  let lightboxScroll;
  let dismissModal;
  let changes = [];
  const start = (player) => {
    active.add(player);
    events.push(['play', player.uri]);
    assert.ok(active.size <= 1, `No overlapping players: ${[...active].map(p => p.uri)}`);
  };
  const stop = (player) => {
    active.delete(player);
    events.push(['pause', player.uri]);
  };
  const Native = React.forwardRef((props, ref) => {
    const player = React.useMemo(() => ({
      uri: props.source.photoUri,
      startPlayback: () => start(player),
      stopPlayback: () => stop(player),
    }), []);
    nativeProps.set(props.source.photoUri, props);
    nativePairs.set(props.source.pairedVideoUri, props);
    nativePlayers.set(props.source.photoUri, player);
    React.useImperativeHandle(ref, () => player, [player]);
    return React.createElement('div', { 'data-native': props.source.photoUri });
  });
  Native.isAvailable = () => true;
  const native = {
    Platform: { OS: 'ios' },
    View: ({ children }) => React.createElement('div', null, children),
    Text: ({ children }) => React.createElement('span', null, children),
    ScrollView: React.forwardRef(({ children, onScroll: handler, style }, ref) => {
      if (style) lightboxScroll = handler;
      else onScroll = handler;
      React.useImperativeHandle(ref, () => ({
        scrollTo(offset) { if (style) scrollCommands.push(offset); },
      }), [style]);
      return React.createElement('div', null, children);
    }),
    Dimensions: { get: () => ({ width: 100, height: 200 }) },
    AppState: {
      currentState: 'active',
      addEventListener: (_type, listener) => {
        appListeners.add(listener);
        return { remove: () => appListeners.delete(listener) };
      },
    },
    Pressable: ({ children, onPress, accessibilityLabel }) =>
      React.createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
    StyleSheet: { absoluteFill: {}, create: value => value },
  };
  const BottomSheetModal = React.forwardRef(({ children, onDismiss }, ref) => {
    const [visible, setVisible] = React.useState(false);
    dismissModal = () => { setVisible(false); onDismiss(); };
    React.useImperativeHandle(ref, () => ({
      present: () => setVisible(true),
      dismiss: dismissModal,
    }));
    return visible ? React.createElement('div', { 'data-modal': true }, children) : null;
  });
  const video = {
    VideoView: ({ player }) => React.createElement('div', { 'data-video': player.uri ?? '' }),
    useVideoPlayer: (uri, setup) => {
      const player = React.useMemo(() => {
        const p = {
          uri, currentTime: 0, playing: false, released: false,
          play() { if (uri) { assert.equal(this.released, false); this.playing = true; start(this); } },
          pause() { this.playing = false; stop(this); },
          tick(seconds) { if (this.playing) this.currentTime += seconds; },
        };
        setup(p);
        players.push(p);
        return p;
      }, [uri]);
      React.useEffect(() => () => { player.released = true; active.delete(player); }, [player]);
      return player;
    },
  };
  const cache = new Map();
  const adapters = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': native,
    'expo-live-photo': { LivePhotoView: Native },
    'expo-image': { Image: React.forwardRef((props, ref) => {
      const player = React.useMemo(() => ({
        uri: props.source.uri,
        startAnimating: () => { start(player); return Promise.resolve(); },
        stopAnimating: () => { stop(player); return Promise.resolve(); },
      }), []);
      React.useImperativeHandle(ref, () => player, [player]);
      player.props = props;
      player.renders = (player.renders ?? 0) + 1;
      images.set(props.source.uri, props);
      gifPlayers.set(props.source.uri, player);
      return React.createElement('div', { 'data-image': props.source.uri });
    }) },
    'expo-video': video,
    '@react-navigation/native': { useIsFocused: () => focused },
    'lucide-react-native': { Volume2: () => null, VolumeX: () => null, X: () => null },
    '@gorhom/bottom-sheet': {
      BottomSheetModal,
      BottomSheetBackdrop: () => null,
      BottomSheetView: native.View,
    },
    './DVNTMediaBadge': { DVNTMediaBadge: () => null },
    './native-feed-playback': { feedAudio: {}, syncFeedPlayer: () => {} },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    cache.set(filename, mod);
    mod.require = (name) => {
      if (name in adapters) return adapters[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.tsx`));
      throw new Error(`Unexpected import ${name}`);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename);
    return mod.exports;
  }
  const { PostMediaCarousel } = load(path.join(directory, 'PostMediaCarousel.tsx'));
  const { useFeedPlaybackEnabled } = load(path.resolve(directory, '../feed/feed-inline-video.tsx'));
  let media = [
    { type: 'livePhoto', url: 'https://cdn/first.heic', livePhotoVideoUrl: 'https://cdn/first.mov' },
    { type: 'livePhoto', url: 'https://cdn/second.heic', livePhotoVideoUrl: 'https://cdn/second.mov' },
    { type: 'animated_video', url: 'https://cdn/animated.mp4' },
    { type: 'video', url: 'https://cdn/video.mp4' },
    { type: 'gif', url: 'https://cdn/animated.gif' },
    { type: 'image', url: 'https://cdn/still.jpg' },
  ];
  function Harness({ visible = true }) {
    const enabled = useFeedPlaybackEnabled();
    return React.createElement(PostMediaCarousel, {
      media,
      width: 100, height: 125, isPlaying: enabled && visible,
      onSlideChange: index => changes.push(index),
    });
  }
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  const render = async (visible = true) => React.act(async () => root.render(React.createElement(Harness, { visible })));
  const slide = async (index) => React.act(async () => onScroll({ nativeEvent: { contentOffset: { x: index * 100 } } }));
  const appState = async (state) => React.act(async () => appListeners.forEach(listener => listener(state)));
  const activeUri = () => [...active].map(player => player.uri);
  const firstUrl = media[0].url, secondUrl = media[1].url;

  await render();
  assert.deepEqual(activeUri(), [], 'native autoplay must wait until its pair loads');
  const staleFirstLoad = nativeProps.get(firstUrl).onLoadComplete;
  await React.act(async () => staleFirstLoad());
  assert.deepEqual(activeUri(), [firstUrl], 'first slide automatically owns playback');
  await React.act(async () => nativeProps.get(secondUrl).onLoadComplete());
  assert.deepEqual(activeUri(), [firstUrl], 'loading a hidden slide cannot play it');
  assert.equal(players.filter(player => player.uri).length, 0, 'hidden videos do not construct remote assets');
  const firstSource = nativeProps.get(firstUrl).source;
  const gifSource = images.get(media[4].url).source;
  const inlineGif = gifPlayers.get(media[4].url);
  const inlineGifProps = inlineGif.props;
  const staleGifLoad = inlineGifProps.onDisplay;
  await React.act(async () => staleGifLoad());
  assert.equal(active.has(gifPlayers.get(media[4].url)), false, 'an offscreen GIF load cannot animate');

  await slide(1);
  assert.deepEqual(activeUri(), [secondUrl]);
  await React.act(async () => staleFirstLoad());
  assert.deepEqual(activeUri(), [secondUrl], 'late native callback cannot restart the former slide');
  await slide(0);
  assert.deepEqual(activeUri(), [firstUrl], 'reverse swipe also stops the previous owner first');
  assert.strictEqual(nativeProps.get(firstUrl).source, firstSource, 'playback changes keep the native asset identity');
  await slide(1);
  await appState('background');
  assert.deepEqual(activeUri(), []);
  assert.equal(nativeProps.get(secondUrl).useDefaultGestureRecognizer, false);
  await appState('active');
  assert.deepEqual(activeUri(), [secondUrl]);
  focused = false; await render(); assert.deepEqual(activeUri(), []);
  focused = true; await render(); assert.deepEqual(activeUri(), [secondUrl]);
  await render(false); assert.deepEqual(activeUri(), [], 'vertical offscreen gate pauses');
  await render(); assert.deepEqual(activeUri(), [secondUrl]);

  const inlineSecond = nativePlayers.get(secondUrl);
  await React.act(async () => node.querySelectorAll('button')[1].click());
  assert.deepEqual(activeUri(), [], 'opening the real native modal suspends the covered carousel');
  assert.ok(node.querySelector('[data-modal]'));
  await React.act(async () => nativeProps.get(secondUrl).onLoadComplete());
  assert.deepEqual(activeUri(), [secondUrl], 'the lightbox retains the Live Photo pair and autoplays its selected page');
  assert.equal(active.has(inlineSecond), false, 'the inline copy remains paused behind the lightbox');
  await React.act(async () => lightboxScroll({ nativeEvent: { contentOffset: { x: 0 } } }));
  assert.deepEqual(activeUri(), [], 'lightbox swipe stops its previous page');
  await React.act(async () => nativeProps.get(firstUrl).onLoadComplete());
  assert.deepEqual(activeUri(), [firstUrl]);
  await appState('background'); assert.deepEqual(activeUri(), []);
  await appState('active'); assert.deepEqual(activeUri(), [firstUrl]);
  await React.act(async () => node.querySelector('[aria-label="Close media viewer"]').click());
  assert.deepEqual(activeUri(), [secondUrl], 'dismissal resumes the previously selected inline slide');
  assert.equal(active.has(inlineSecond), true);
  await React.act(async () => node.querySelectorAll('button')[1].click());
  assert.deepEqual(activeUri(), []);
  await React.act(async () => dismissModal());
  assert.deepEqual(activeUri(), [secondUrl], 'pan/backdrop dismissal uses the same resume boundary');

  await slide(2);
  let animated = players.find(player => player.uri === media[2].url);
  animated.tick(2);
  assert.equal(animated.currentTime, 2);
  assert.equal(animated.muted, true);
  assert.equal(animated.loop, true);
  assert.equal(animated.audioMixingMode, 'mixWithOthers');
  await slide(3);
  animated.tick(2); assert.equal(animated.currentTime, 2);
  let ordinary = players.find(player => player.uri === media[3].url);
  ordinary.tick(2); assert.equal(ordinary.currentTime, 2, 'regular mixed-carousel video is not a thumbnail');
  await appState('inactive'); ordinary.tick(2); assert.equal(ordinary.currentTime, 2);
  await appState('active'); ordinary.tick(1); assert.equal(ordinary.currentTime, 3);
  focused = false; await render(); assert.equal(ordinary.playing, false);
  focused = true; await render(); assert.equal(ordinary.playing, true);

  media = media.map((item, index) => index === 3 ? { ...item, url: 'https://cdn/replaced.mp4' } : item);
  await render();
  assert.equal(ordinary.playing, false);
  assert.equal(ordinary.released, true);
  assert.deepEqual(activeUri(), ['https://cdn/replaced.mp4']);
  media = media.map((item, index) => index === 2 ? { ...item, url: 'https://cdn/replaced-hidden.mp4' } : item);
  await render();
  assert.equal(players.some(player => player.uri === 'https://cdn/replaced-hidden.mp4'), false, 'recycled hidden source must reset the lazy-load latch');
  await slide(2); assert.deepEqual(activeUri(), ['https://cdn/replaced-hidden.mp4']);
  await slide(4); assert.deepEqual(activeUri(), [media[4].url]);
  assert.equal(images.get(media[4].url).autoplay, false, 'native autoplay remains constant even when active');
  assert.strictEqual(inlineGif.props.source, gifSource, 'swiping never replaces the GIF source');
  assert.strictEqual(inlineGif.props, inlineGifProps, 'playback does not rerender native Image props');
  assert.equal(inlineGif.renders, 1);
  await appState('background'); assert.deepEqual(activeUri(), []);
  await appState('active'); assert.deepEqual(activeUri(), [media[4].url]);
  media = media.map((item, index) => index === 4 ? { ...item, url: 'https://cdn/replaced.gif' } : item);
  await render();
  assert.deepEqual(activeUri(), [], 'replacing an active GIF waits for the new decoded image');
  await React.act(async () => staleGifLoad());
  assert.deepEqual(activeUri(), [], 'the previous GIF display callback cannot restart its old decoder');
  const replacementGifDisplay = images.get(media[4].url).onDisplay;
  await React.act(async () => replacementGifDisplay());
  assert.deepEqual(activeUri(), [media[4].url]);
  await slide(5); assert.equal(images.get(media[4].url).autoplay, false);
  await React.act(async () => replacementGifDisplay());
  assert.equal(active.has(gifPlayers.get(media[4].url)), false, 'a late GIF load cannot restart an inactive page');
  assert.deepEqual(activeUri(), [], 'static slide never starts a player');
  await slide(-2); assert.equal(changes.at(-1), 0, 'negative bounce clamps to first page');
  await slide(100); assert.equal(changes.at(-1), media.length - 1, 'end bounce clamps to final page');
  await slide(0);

  await React.act(async () => nativeProps.get(firstUrl).onLoadError());
  assert.deepEqual(activeUri(), ['https://cdn/first.mov'], 'broken native metadata falls back to the paired video');
  await React.act(async () => staleFirstLoad());
  assert.deepEqual(activeUri(), ['https://cdn/first.mov'], 'late native load cannot start behind the fallback');
  media = media.map((item, index) => index === 0 ? { ...item, livePhotoVideoUrl: 'https://cdn/repaired.mov' } : item);
  await render();
  assert.deepEqual(activeUri(), [], 'paired URL replacement gets a fresh load boundary');
  assert.ok(node.querySelector(`[data-native="${firstUrl}"]`));
  await React.act(async () => staleFirstLoad());
  assert.deepEqual(activeUri(), [], 'old pair load completion is ignored after remount');
  await React.act(async () => nativeProps.get(firstUrl).onLoadComplete());
  assert.deepEqual(activeUri(), [firstUrl]);
  const staleUnmountLoad = nativeProps.get(firstUrl).onLoadComplete;
  await React.act(async () => root.unmount());
  assert.deepEqual(activeUri(), [], 'unmount stops the native view even though its ref was cleared');
  await React.act(async () => { staleUnmountLoad(); replacementGifDisplay(); });
  assert.deepEqual(activeUri(), []);
  assert.equal(appListeners.size, 0);

  // Duplicate still URLs must retain separate paired-video/lightbox indices.
  media = [
    { type: 'livePhoto', url: 'https://cdn/duplicate.heic', livePhotoVideoUrl: 'https://cdn/duplicate-a.mov' },
    { type: 'livePhoto', url: 'https://cdn/duplicate.heic', livePhotoVideoUrl: 'https://cdn/duplicate-b.mov' },
  ];
  const secondRoot = createRoot(node);
  await React.act(async () => secondRoot.render(React.createElement(Harness)));
  await React.act(async () => nativePairs.get(media[0].livePhotoVideoUrl).onLoadComplete());
  scrollCommands.length = 0;
  await React.act(async () => node.querySelectorAll('button')[0].click());
  assert.equal(nativePairs.get(media[0].livePhotoVideoUrl).useDefaultGestureRecognizer, true);
  assert.equal(nativePairs.get(media[1].livePhotoVideoUrl).useDefaultGestureRecognizer, false);
  await React.act(async () => dismissModal());
  await React.act(async () => node.querySelectorAll('button')[1].click());
  assert.equal(nativePairs.get(media[0].livePhotoVideoUrl).useDefaultGestureRecognizer, false);
  assert.equal(nativePairs.get(media[1].livePhotoVideoUrl).useDefaultGestureRecognizer, true);
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(scrollCommands.length, 1, 'rapid close/reopen cancels the previous delayed scroll');
  assert.equal(scrollCommands[0].x, 100, 'the remaining scroll targets the newly opened page');
  await React.act(async () => secondRoot.unmount());
  assert.deepEqual(activeUri(), []);
  assert.equal(appListeners.size, 0);
  assert.ok(events.some(([type, uri]) => type === 'pause' && uri === firstUrl));

  const screen = fs.readFileSync(path.resolve(directory, '../../features/routes/screens/(protected)/post/[id].tsx'), 'utf8');
  assert.match(screen, /routePlaybackEnabled = useFeedPlaybackEnabled\(\)/);
  assert.match(screen, /mediaPlaybackEnabled = routePlaybackEnabled && mediaVisible/);
  assert.match(screen, /mediaViewport\.current\.offset = event\.nativeEvent\.contentOffset\.y/);
  assert.match(screen, /m\?\.type, m\?\.url, m\?\.livePhotoVideoUrl/);
  assert.match(screen, /<PostMediaCarousel\s+key=\{postId\}/);
  assert.doesNotMatch(screen, /isPlaying=\{true\}/);
  window.happyDOM.abort();
  console.log('PASS native post carousel: first autoplay, forward/reverse and lightbox handoff without overlap, focus/background/viewport pause, mixed video playback, lazy source replacement, GIF identity, stale native callbacks, paired fallback and unmount. Native decoding is mocked.');
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
