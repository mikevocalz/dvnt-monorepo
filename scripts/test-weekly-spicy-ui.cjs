const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const base = "packages/app/components/feed/";
let viewer = { id: "1", authId: "viewer-a" },
  status = "none",
  failed = false,
  pending = false,
  statusError = false,
  adult = true,
  admitted = true;
let calls = [];
const auth = Object.assign((fn) => fn({ user: viewer }), {
  getState: () => ({ user: viewer }),
});
const jsx = (type, props) => ({ type, props });
const noop = new Proxy(function () {}, {
  get: (_, p) => (p === "__esModule" ? true : noop),
  apply: () => noop,
});
const React = {
  Component: class {},
  lazy: () => noop,
  createContext: (x) => ({ value: x }),
  memo: (fn) => fn,
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (x) => ({ current: x }),
  useEffect() {},
  useLayoutEffect() {},
  useState: (x) => [x, () => {}],
  forwardRef: (fn) => fn,
};
React.default = React;
const native = {
  View: "view",
  Text: "text",
  Pressable: "button",
  StyleSheet: { create: (x) => x, flatten: (x) => x, absoluteFillObject: {} },
  Platform: { OS: "ios", select: (x) => x.ios || x.default },
  Dimensions: { get: () => ({ width: 390, height: 800 }) },
  useWindowDimensions: () => ({ width: 390, height: 800 }),
};
const loaded = {};
function load(file, extra = "", overrides = {}) {
  const exports = {};
  const source = fs.readFileSync(file, "utf8") + extra;
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });
  assert.equal(
    result.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
      .length,
    0,
    file,
  );
  const req = (name) => {
    if (overrides[name]) return overrides[name];
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return React;
    if (name === "react-native") return native;
    if (name.includes("auth-store")) return { useAuthStore: auth };
    if (name.endsWith("follow-identity"))
      return {
        getFollowIdentity: () =>
          viewer
            ? {
                viewerId: viewer.id,
                authId: viewer.authId,
                epoch: 0,
                revision: 0,
              }
            : null,
        isFollowIdentityCurrent: (identity) =>
          !!identity &&
          identity.viewerId === viewer?.id &&
          identity.authId === viewer?.authId,
      };
    if (name.endsWith("spicy-lock")) return loaded.lock;
    if (name.endsWith("use-spicy-follow-gate")) return loaded.hook;
    if (name.endsWith("spicy-follow-gate"))
      return { SpicyFollowGate: "PROTECTED" };
    if (name.endsWith("use-follow-requests"))
      return {
        useFollowRequestStatus: () => ({
          data: status,
          following: status === "approved",
          isLoading: false,
          isError: statusError,
          refetch: () => calls.push("retry"),
        }),
      };
    if (name.endsWith("use-follow"))
      return {
        useFollow: () => ({
          mutate: (arg) => calls.push(arg),
          isPending: pending,
          isError: failed,
        }),
      };
    if (name.endsWith("use-age-verification"))
      return {
        useVerificationState: () => ({
          data: { state: adult ? "approved" : "rejected" },
        }),
      };
    if (name.endsWith("use-verified-admission"))
      return {
        useVerifiedAdmission: () => ({
          data: { state: admitted ? "allowed" : "blocked" },
        }),
      };
    if (name.includes("react-native-reanimated"))
      return {
        ...React,
        default: { ...native, createAnimatedComponent: (x) => x },
        Easing: noop,
      };
    return noop;
  };
  vm.runInNewContext(
    result.outputText,
    {
      exports,
      require: req,
      console,
      setTimeout,
      clearTimeout,
      Map,
      Set,
      URL,
      process: { env: {} },
      __DEV__: false,
      document: { body: { style: {} } },
    },
    { filename: file },
  );
  return exports;
}
loaded.lock = load(base + "spicy-lock.ts");
loaded.hook = load(base + "use-spicy-follow-gate.ts");
const secret = {
  id: "p1",
  isNSFW: true,
  isSpicyLocked: true,
  spicyAccessViewerId: "viewer-a",
  author: { id: "2", username: "owner" },
  media: [{ type: "image", url: "SECRET_MEDIA" }],
  caption: "SECRET_TEXT",
  textSlides: [{ text: "SECRET_SLIDE" }],
  coverUrl: "SECRET_MEDIA",
  videoUrl: "SECRET_VIDEO",
  kind: "text",
  text: "SECRET_TEXT",
};
assert.equal(loaded.lock.isSpicyPostLocked(secret), true);
assert.equal(
  loaded.lock.isSpicyPostLocked({ ...secret, isSpicyLocked: false }),
  false,
);
assert.equal(
  loaded.lock.isSpicyPostLocked({
    ...secret,
    isSpicyLocked: false,
    spicyAccessViewerId: undefined,
  }),
  true,
);
viewer = { id: "3", authId: "viewer-b" };
assert.equal(
  loaded.lock.isSpicyPostLocked({ ...secret, isSpicyLocked: false }),
  true,
);
viewer = null;
assert.equal(
  loaded.lock.isSpicyPostLocked({ ...secret, isSpicyLocked: false }),
  true,
);
viewer = { id: "1", authId: "viewer-a" };
const gate = () => loaded.hook.useSpicyFollowGate(secret.author);
gate().act();
assert.equal(calls.pop().action, "follow");
status = "pending";
assert.equal(gate().label, "Cancel follow request");
gate().act();
assert.equal(calls.pop().action, "unfollow");
status = "approved";
gate().act();
assert.equal(calls.pop().action, "unfollow");
for (const state of [
  "pendingMutation",
  "failedStatus",
  "minor",
  "denied",
  "guest",
  "unknownStatus",
]) {
  pending = state === "pendingMutation";
  statusError = state === "failedStatus";
  adult = state !== "minor";
  admitted = state !== "denied";
  viewer = state === "guest" ? null : { id: "1", authId: "viewer-a" };
  status = state === "unknownStatus" ? undefined : "none";
  calls = [];
  assert.equal(gate().disabled, true, state);
  gate().act();
  assert.equal(calls.length, 0, state);
}
viewer = { id: "1", authId: "viewer-a" };
pending = false;
statusError = false;
adult = true;
admitted = true;
status = "none";
failed = true;
assert.equal(gate().failed, true);
assert.equal(
  loaded.lock.isSpicyPostLocked(secret),
  true,
  "failed follow cannot unlock",
);
for (const file of ["spicy-follow-gate.tsx", "spicy-follow-gate.web.tsx"]) {
  const tree = load(base + file).SpicyFollowGate({ author: secret.author });
  assert.match(JSON.stringify(tree), /Request to FOLLOW/);
  assert.doesNotMatch(JSON.stringify(tree), /SECRET_/);
  assert.match(JSON.stringify(tree), /Could not update follow/);
}
const checks = [
  [
    "packages/app/features/location/location-detail.web.tsx",
    "LocationPostGate",
    {
      post: secret,
      height: 180,
      children: jsx("img", { src: "SECRET_MEDIA" }),
    },
  ],
  [base + "feed-post.tsx", "FeedPost", { ...secret, likes: 0, comments: 0 }],
  [
    base + "masonry-feed.tsx",
    "MasonryCell",
    { post: secret, width: 180, height: 230 },
  ],
  [
    "packages/app/features/home/screen.web.tsx",
    "MasonryCell",
    { post: secret, fallbackHeight: 230 },
  ],
  ["packages/app/features/search/search.web.tsx", "PostTile", { post: secret }],
  [
    "packages/app/features/profile/ProfileMasonryGrid.web.tsx",
    "GridCell",
    { tile: secret, fallbackHeight: 230 },
  ],
  [
    "packages/app/features/profile/ui/ProfileMasonryGrid.tsx",
    "GridCell",
    { tile: secret, width: 180, height: 230 },
  ],
  [
    "packages/app/features/routes/screens/(protected)/search.tsx",
    "PostGridTile",
    { post: secret, size: 180 },
  ],
  [
    "packages/app/features/routes/screens/(protected)/location/[placeId].tsx",
    "PostGridItem",
    { post: secret, size: 180 },
  ],
];
for (const [file, name, props] of checks) {
  const component = load(file, `\nexports.__test = ${name};`).__test;
  for (const mode of ["locked", "missing", "accountChanged", "revoked"]) {
    const post = props.post || props.tile || props;
    post.isSpicyLocked =
      mode === "missing" ? undefined : mode === "accountChanged" ? false : true;
    viewer = {
      id: "1",
      authId: mode === "accountChanged" ? "viewer-b" : "viewer-a",
    };
    const tree = component(props);
    assert.match(JSON.stringify(tree), /PROTECTED/, `${file}: ${mode}`);
    assert.doesNotMatch(
      JSON.stringify(tree),
      /SECRET_/,
      `${file}: ${mode} content mounted`,
    );
  }
}
// Actual mapper and prefetch function must discard URLs even if stale cache contains them.
viewer = { id: "1", authId: "viewer-b" };
const mapper = load("packages/app/lib/utils/safe-profile-mappers.ts");
assert.doesNotMatch(
  JSON.stringify(mapper.safeGridTile({ ...secret, isSpicyLocked: false })),
  /SECRET_/,
);
const prefetch = load("packages/app/lib/perf/image-prefetch.ts");
assert.equal(
  prefetch.extractFeedImageUrls([{ ...secret, isSpicyLocked: false }]).length,
  0,
);
// Detail boundaries must mount no content subtree, including hydration/comment hooks.
viewer = { id: "1", authId: "viewer-a" };
secret.isSpicyLocked = true;
for (const [file, name] of [
  ["packages/app/features/post/post-detail.web.tsx", "PostDetailScreen"],
  ["packages/app/features/routes/screens/(protected)/post/[id].tsx", "default"],
]) {
  const navigation = {
    useParams: () => ({ id: "p1" }),
    useLocalSearchParams: () => ({ id: "p1" }),
    useRouter: () => ({ back() {} }),
  };
  const overrides = {
    "solito/navigation": navigation,
    "expo-router": navigation,
    "@dvnt/app/lib/hooks/use-posts": { usePost: () => ({ data: secret }) },
    "@dvnt/app/lib/navigation/route-params": { normalizeRouteParams: (p) => p },
    "@dvnt/app/lib/validation/post-params": {
      validatePostParams: (p) => ({ valid: true, postId: p.id }),
    },
  };
  const tree = load(file, "", overrides)[name]();
  assert.match(JSON.stringify(tree), /PROTECTED/, file);
  assert.doesNotMatch(JSON.stringify(tree), /SECRET_/, file);
}
// Actual Public/Private settings handlers and read/save failure states.
function walk(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (predicate(node)) result.push(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children)
    ? children.flat(Infinity)
    : [children])
    walk(child, predicate, result);
  return result;
}
for (const [file, name] of [
  ["packages/app/features/settings/privacy.web.tsx", "PrivacyScreen"],
  ["packages/app/features/routes/screens/settings/privacy.tsx", "default"],
]) {
  let settingsError = false,
    mutationPending = false;
  const overrides = {
    "solito/navigation": { useRouter: () => ({ back() {} }) },
    "expo-router": {
      useRouter: () => ({ back() {} }),
      useNavigation: () => ({ setOptions() {} }),
    },
    "@dvnt/app/lib/hooks": { useColorScheme: () => ({ colors: {} }) },
    "@dvnt/app/lib/hooks/use-user-settings": {
      usePrivacySettings: () => ({
        data: { privateAccount: false },
        error: settingsError,
        refetch: () => calls.push("retry"),
      }),
      useUpdatePrivacySettings: () => ({
        mutate: (arg) => calls.push(arg),
        isPending: mutationPending,
        isError: true,
      }),
    },
  };
  const screen = load(file, "", overrides)[name];
  let tree = screen();
  const radios = walk(
    tree,
    (n) => n.props?.role === "radio" || n.props?.accessibilityRole === "radio",
  );
  assert.equal(radios.length, 2, file);
  calls = [];
  for (const radio of radios) (radio.props.onClick || radio.props.onPress)();
  assert.equal(calls[0].privateAccount, false);
  assert.equal(calls[1].privateAccount, true);
  assert.match(JSON.stringify(tree), /Public/);
  assert.match(JSON.stringify(tree), /Private/);
  assert.match(JSON.stringify(tree), /Could not save visibility/);
  mutationPending = true;
  tree = screen();
  assert.ok(
    walk(
      tree,
      (n) =>
        n.props?.role === "radio" || n.props?.accessibilityRole === "radio",
    ).every((n) => n.props.disabled),
  );
  settingsError = true;
  tree = screen();
  assert.match(JSON.stringify(tree), /Could not load privacy settings/);
  assert.equal(
    walk(
      tree,
      (n) =>
        n.props?.role === "radio" || n.props?.accessibilityRole === "radio",
    ).length,
    0,
  );
}
// Rapid presses and callbacks captured before an account switch cannot send duplicate/other-viewer follows.
status = "none";
failed = false;
calls = [];
const repeated = gate();
repeated.act();
repeated.act();
assert.equal(calls.length, 1);
const oldViewer = gate();
viewer = { id: "3", authId: "viewer-b" };
calls = [];
oldViewer.act();
assert.equal(calls.length, 0);
console.log(
  "PASS actual native/web gates and 9 feed/grid components: protected media/text never mounted; missing projection, account switch, revocation, follow/request/cancel/unfollow/failures, adult/admission/guest controls, mapper and prefetch fail closed.",
);

// Mount actual detached overlay components against their actual Zustand store
// actions. Reset on follow revocation or auth change must remove existing media.
function createStore(init) {
  let state;
  const listeners = new Set();
  const get = () => state;
  const set = (update) => {
    const old = state;
    state = {
      ...state,
      ...(typeof update === "function" ? update(state) : update),
    };
    for (const listener of listeners) listener(state, old);
  };
  const store = Object.assign((selector) => selector(state), {
    getState: get,
    setState: set,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
  state = init(set, get);
  return store;
}
const storeDeps = { zustand: { create: createStore } };
const lightboxStore = load(
  "packages/app/lib/stores/lightbox-store.ts",
  "",
  storeDeps,
).useLightboxStore;
const webShareStore = load(
  "packages/app/lib/stores/web-post-share-store.ts",
  "",
  storeDeps,
).useWebPostShareStore;
const feedUIStore = load(
  "packages/app/lib/stores/feed-post-store.ts",
  "",
  storeDeps,
).useFeedPostUIStore;
const accountStore = createStore(() => ({ user: { authId: "viewer-a" } }));
const overlayDeps = {
  "@dvnt/app/lib/stores/auth-store": { useAuthStore: accountStore },
  "@dvnt/app/lib/stores/lightbox-store": { useLightboxStore: lightboxStore },
  "@dvnt/app/lib/stores/web-post-share-store": {
    useWebPostShareStore: webShareStore,
  },
  "@dvnt/app/lib/stores/feed-post-store": { useFeedPostUIStore: feedUIStore },
  react: { ...React, useSyncExternalStore: (_, get) => get() },
  "react-dom": { createPortal: (tree) => tree },
  "./feed/web-post-media": {
    resolveWebPostMedia: (item) => ({ posterUrl: item.url }),
    isWebLivePhoto: () => false,
  },
};
const lifecycle = load(
  "packages/app/lib/posts/revoke-post-overlays.ts",
  "",
  overlayDeps,
);
overlayDeps["@dvnt/app/lib/posts/revoke-post-overlays"] = lifecycle;
const Lightbox = load(
  "packages/app/components/lightbox.web.tsx",
  "",
  overlayDeps,
).Lightbox;
const Share = load(
  "packages/app/components/share-to-inbox-sheet.web.tsx",
  "",
  overlayDeps,
).ShareToInboxSheet;
const previousDocument = global.document;
// The VM portal only needs a target; supply it for the actual component render.
// load() renders in this VM; its document is supplied below through test globals.
for (const reason of ["unfollow", "account switch"]) {
  lightboxStore.getState().openAt([{ type: "image", url: "SECRET_MEDIA" }], 0);
  webShareStore.getState().open({ postId: "p1", caption: "SECRET_TEXT" });
  feedUIStore.setState({
    previewMedia: { type: "image", uri: "SECRET_MEDIA" },
    showPreviewModal: true,
    shareSheetPostId: "p1",
    videoStates: { p1: { isFullscreen: true } },
  });
  assert.ok(Share(), "share body mounted before revocation");
  assert.match(
    JSON.stringify(Lightbox()),
    /SECRET_MEDIA/,
    "lightbox media mounted before revocation",
  );
  if (reason === "unfollow") lifecycle.resetPostAccessOverlays();
  else accountStore.setState({ user: { authId: "viewer-b" } });
  assert.equal(Share(), null, reason);
  assert.equal(Lightbox(), null, reason);
  assert.equal(lightboxStore.getState().items.length, 0, reason);
  assert.equal(feedUIStore.getState().previewMedia, null, reason);
  assert.equal(feedUIStore.getState().shareSheetPostId, null, reason);
  assert.equal(
    Object.keys(feedUIStore.getState().videoStates).length,
    0,
    reason,
  );
}
console.log(
  "PASS mounted detached lightbox/share lifecycle: synchronous follow revocation and account switch close overlays and erase retained media.",
);
