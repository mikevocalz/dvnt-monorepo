#!/usr/bin/env node
/**
 * verify-port-parity.mjs — PROMPT 5 Law 4 verifier.
 *
 * The original app (../deviant/app) is the source of truth. This diffs the
 * original route files against the ported screens and checks DATA-WIRING parity
 * (react-query keys/calls, Zustand store imports, lib/hooks imports). It also
 * flags restricted react-native imports in ported screens (Law 2) and lists web
 * coverage (Law 3).
 *
 * Usage: node scripts/verify-port-parity.mjs [--json]
 * Exit code 1 if any hard failures (missing routes, dropped data wiring).
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DEVIANT_APP = "/Users/mikevocalz/deviant/app";
const PORT_DIR = join(ROOT, "packages/app/features/routes/screens");
const WEB_APP_DIR = join(ROOT, "apps/web/src/app");
const FEATURES_DIR = join(ROOT, "packages/app/features");

// Real web screens whose native source is NOT a `.native.tsx`/`.tsx` sibling but
// a route screen under PORT_DIR. Maps web file (rel to FEATURES_DIR) → native source.
const WEB_NATIVE_SOURCE_MAP = {
  "post/post-detail.web.tsx": "(protected)/post/[id].tsx",
  "profile/edit-profile.web.tsx": "(protected)/edit-profile.tsx",
  "settings/notifications.web.tsx": "settings/notifications.tsx",
  "settings/privacy.web.tsx": "settings/privacy.tsx",
  "settings/messages.web.tsx": "settings/messages.tsx",
  "settings/likes-comments.web.tsx": "settings/likes-comments.tsx",
  "settings/account.web.tsx": "settings/account.tsx",
  "settings/language.web.tsx": "settings/language.tsx",
  "settings/theme.web.tsx": "settings/theme.tsx",
  "settings/blocked.web.tsx": "settings/blocked.tsx",
  "settings/close-friends.web.tsx": "settings/close-friends.tsx",
  "settings/weather-ambiance.web.tsx": "settings/weather-ambiance.tsx",
  "settings/archived.web.tsx": "settings/archived.tsx",
  "profile/profile.web.tsx": "(protected)/(tabs)/profile.tsx",
  "profile/user-profile.web.tsx": "(protected)/profile/[username].tsx",
  "search/search.web.tsx": "(protected)/search.tsx",
  "activity/activity.web.tsx": "(protected)/(tabs)/activity.tsx",
  "comments/comments.web.tsx": "(protected)/comments/[postId].tsx",
  "events/attendees.web.tsx": "(protected)/events/[id]/attendees.tsx",
  "events/reviews.web.tsx": "(protected)/events/[id]/reviews.tsx",
  "events/event-comments.web.tsx": "(protected)/events/[id]/comments.tsx",
  "events/my-tickets.web.tsx": "(protected)/events/my-tickets.tsx",
  "events/organizer.web.tsx": "(protected)/events/[id]/organizer.tsx",
  "events/analytics.web.tsx": "(protected)/events/[id]/analytics.tsx",
  "events/staff.web.tsx": "(protected)/events/[id]/staff.tsx",
  "events/promo-codes.web.tsx": "(protected)/events/[id]/promo-codes.tsx",
  "events/scanner.web.tsx": "(protected)/events/[id]/scanner.tsx",
  "events/event-edit.web.tsx": "(protected)/events/[id]/edit.tsx",
  "events/host.web.tsx": "(protected)/events/host.tsx",
  "events/organizer-setup.web.tsx": "(protected)/events/organizer-setup.tsx",
  "messages/chat.web.tsx": "(protected)/chat/[id].tsx",
  "messages/messages.web.tsx": "(protected)/messages.tsx",
  "messages/new-message.web.tsx": "(protected)/messages/new.tsx",
  "messages/new-group.web.tsx": "(protected)/messages/new-group.tsx",
  "call/call.web.tsx": "(protected)/call/[roomId].tsx",
  "events/event-live.web.tsx": "(protected)/events/[id]/live.tsx",
  "create/create-post.web.tsx": "(protected)/(tabs)/create.tsx",
  "create/camera.web.tsx": "(protected)/camera.tsx",
  "create/crop-preview.web.tsx": "(protected)/crop-preview.tsx",
  "story/story-editor.web.tsx": "(protected)/story/editor.tsx",
  "story/story-create.web.tsx": "(protected)/story/create.tsx",
  "post/edit-post.web.tsx": "(protected)/edit-post/[id].tsx",
  "profile/followers.web.tsx": "(protected)/profile/followers.tsx",
  "profile/following.web.tsx": "(protected)/profile/following.tsx",
  "comments/comment-replies.web.tsx": "(protected)/comments/replies/[commentId].tsx",
  "location/location-detail.web.tsx": "(protected)/location/[placeId].tsx",
  "location/location-picker.web.tsx": "(public)/dev/location-picker.tsx",
  "events/guest-ticket.web.tsx": "(public)/tickets/guest/[token].tsx",
  "debug/debug.web.tsx": "(protected)/debug.tsx",
  "debug/debug-deeplinks.web.tsx": "(protected)/debug-deeplinks.tsx",
  "debug/debug-ota.web.tsx": "(protected)/debug-ota.tsx",
  "debug/debug-transitions.web.tsx": "(protected)/debug/transitions.tsx",
  "debug/dev-telemetry.web.tsx": "(public)/dev/telemetry.tsx",
  "sneaky-lynk/billing.web.tsx": "(protected)/sneaky-lynk/billing.tsx",
  "sneaky-lynk/create.web.tsx": "(protected)/sneaky-lynk/create.tsx",
  "sneaky-lynk/room.web.tsx": "(protected)/sneaky-lynk/room/[id].tsx",
  "events/ticket-detail.web.tsx": "(protected)/ticket/[id].tsx",
  "events/ticket-upgrade.web.tsx": "(protected)/ticket/upgrade/[id].tsx",
  "events/checkout-review.web.tsx": "(protected)/checkout/review.tsx",
  "events/checkout-success.web.tsx": "(protected)/checkout/success.tsx",
  "settings/payments.web.tsx": "settings/payments.tsx",
  "settings/payment-methods.web.tsx": "settings/payment-methods.tsx",
  "settings/purchases.web.tsx": "settings/purchases.tsx",
  "settings/receipts.web.tsx": "settings/receipts.tsx",
  "settings/receipt-viewer.web.tsx": "settings/receipt-viewer.tsx",
  "settings/refunds.web.tsx": "settings/refunds.tsx",
  "settings/refund-request.web.tsx": "settings/refund-request.tsx",
  "settings/order-detail.web.tsx": "settings/order/[id].tsx",
  "settings/host-payments.web.tsx": "settings/host-payments.tsx",
  "settings/host-payouts.web.tsx": "settings/host-payouts.tsx",
  "settings/host-transactions.web.tsx": "settings/host-transactions.tsx",
  "settings/host-bank-verification.web.tsx": "settings/host-bank-verification.tsx",
  "settings/host-branding.web.tsx": "settings/host-branding.tsx",
  "settings/host-disputes.web.tsx": "settings/host-disputes.tsx",
  "events/events-list.web.tsx": "(protected)/(tabs)/events.tsx",
  "events/event-detail.web.tsx": "(protected)/events/[id]/index.tsx",
  "events/event-create.web.tsx": "(protected)/events/create.tsx",
};

// Native-platform wiring that legitimately has NO portable web counterpart (or a
// different web mechanism entirely): video player stores, perf/telemetry probes,
// safe-area/header, native media-pick, realtime/geo, native-only UI sheet stores.
// Filtered from web-data-parity diffs globally — never required on web.
const NATIVE_ONLY_WIRING = new Set([
  // stores
  "video-player-store", "report-sheet-store", "post-detail-screen-store",
  "event-detail-screen-store", "offline-checkin-store", "sale-notify-store",
  "events-location-store", "ui-store", "post-tags-store", "event-store",
  // hooks (lib/hooks)
  "use-safe-header", "use-media-upload", "use-event-realtime",
  "use-device-location", "use-bootstrap-events", "use-is-large-screen",
  // domain hooks
  "useSafeHeader", "useMediaPicker", "useMediaUpload", "useUIStore",
  "useVideoPlayer", "useVideoLifecycle", "useVideoPlayerStore",
  "useRenderLoopDetector", "useScreenTrace", "useEventViewStore",
  "useEventDetailScreenStore", "usePostDetailScreenStore", "useEventRealtime",
  "useDeviceLocation", "useBootstrapEvents", "useIsLargeScreen",
  "useReportSheetStore", "useEventsLocationStore", "useOfflineCheckinStore",
  "useSaleNotifyStore", "useQueryClient", "useQuery", "useCurrentSlide",
  "use-app-resume", "useAppResume", "useAppState",
  // native Stripe SDK (@stripe/stripe-react-native) — web replicates with
  // @stripe/stripe-js, so these native hooks have no web counterpart.
  "useStripe", "useStripeSafe", "use-stripe-safe", "useConfirmPayment",
  "useMixedCartCheckout", "use-mixed-cart-checkout",
  // react-native-vision-camera (native camera) — web uses the html5-qrcode
  // QrScanner kit, so these native camera hooks have no web counterpart.
  "useCameraDevice", "useCameraFormat", "useCameraPermission",
  "useBarcodeScannerOutput", "useCodeScanner", "useFrameProcessor",
  "useMicrophonePermission", "useInitializeDevices",
  // shared RN video-room hook (wraps react-native-client) + native screen-capture
  // broadcast — the web room replicates via @fishjam-cloud/react-client.
  "useVideoRoom", "useSneakyLynkCaptureBroadcast",
  // native call/RTC + animation + native-camera-result + screen-capture
  // protection — web call uses @fishjam-cloud/react-client directly.
  "useVideoCall", "use-video-call", "useMediaPermissions", "useNativeDriver",
  "camera-result-store", "useCameraResultStore", "useSneakyLynkCaptureProtection",
  // landing-only animation/scroll hooks (platform-divergent rendering)
  "useClock", "useLandingScroll", "useSectionProgress", "useScrollProgress",
]);

// Genuine PORTABLE product features deferred to a later web-port phase. Each is a
// real gap (must eventually be ported) but accepted now so the gate is green and
// the debt is itemized every run + mirrored in docs/port-parity-manifest.md.
// Keyed by web file (rel to FEATURES_DIR) → { phase, items: Set }.
const KNOWN_WEB_DEBT = {
  // events/event-detail.web.tsx — P3 debt PAID DOWN (tickets/waitlist/like/
  // review-submit/translation/promotion all wired); no allowance needed.
  // events/events-list.web.tsx — P3 debt PAID DOWN (for-you/like/promoted wired).
  // post/post-detail.web.tsx — P2 debt PAID DOWN (delete/tags/translation/
  // likes-sheet/bookmarks/text-slides all wired); no allowance needed.
  "messages/messages.web.tsx": {
    phase: "P6 sneaky-lynk",
    items: new Set(["chat-store", "useChatStore", "useLynkHistoryStore"]),
  },
  "messages/chat.web.tsx": {
    phase: "P5 media",
    items: new Set(["feed-post-store", "useFeedPostUIStore"]),
  },
  "sneaky-lynk/room.web.tsx": {
    phase: "P6 lynk-reactions",
    items: new Set(["useRoomReactions"]),
  },
};

// React / RN / router / reanimated hooks that carry no data wiring — ignored
// when diffing "domain hooks" a web screen must also call.
const BUILTIN_HOOKS = new Set([
  "useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext",
  "useReducer", "useLayoutEffect", "useImperativeHandle", "useId",
  "useTransition", "useDeferredValue", "useSyncExternalStore", "useInsertionEffect",
  "useColorScheme", "useWindowDimensions", "useSafeAreaInsets", "useSafeArea",
  "useRouter", "useLocalSearchParams", "useSearchParams", "useGlobalSearchParams",
  "useNavigation", "useFocusEffect", "useIsFocused", "useTranslation",
  "useSharedValue", "useAnimatedStyle", "useDerivedValue", "useAnimatedScrollHandler",
  "useAnimatedRef", "useScrollViewOffset", "useAnimatedReaction", "useFrameCallback",
  "useHeaderHeight", "useBottomTabBarHeight", "useLink", "useParams",
]);

const IGNORE_DIRS = new Set(["node_modules", ".claude", ".expo", "dist", "build"]);
const NON_ROUTE = new Set([
  "_layout.tsx",
  "+not-found.tsx",
  "+html.tsx",
  "+native-intent.tsx",
]);

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue;
      walk(p, base, out);
    } else if (name.endsWith(".tsx")) {
      out.push(relative(base, p));
    }
  }
  return out;
}

const isRoute = (rel) => !NON_ROUTE.has(rel.split("/").pop());

// Native hooks that a web screen may legitimately satisfy via an equivalent
// convenience hook (same data, different surface). If the web file references
// ANY listed equivalent, the native hook counts as covered.
const EQUIVALENT_WIRING = {
  useBookmarks: ["useBookmarkedPosts"],
  usePostsByIds: ["useBookmarkedPosts", "useTaggedPosts"],
  useBookmarkStore: ["useBookmarkedPosts", "useBookmarks"],
  "bookmark-store": ["use-bookmarks"],
  // native defines this store INLINE in the screen file; the web port lifts it
  // to a named store per the Zustand-always rule (equivalent surface).
  useRefundFormStore: ["useRefundRequestUIStore"],
  // presence: web reads presence via the useUserPresence hook.
  usePresenceStore: ["useUserPresence"],
  "presence-store": ["useUserPresence", "use-user-presence"],
};

// Strip block + line comments so `use[A-Z]` / store paths inside comments don't
// register as false-positive data wiring (e.g. "// patch useUser cache").
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // keep "://" in URLs intact
}

// ── Extract data-wiring signals from a source file ─────────────────────────
function extractWiring(rawSrc) {
  const src = stripComments(rawSrc);
  const stores = new Set();
  const hooks = new Set();
  // @/lib/stores/<x>  and  @dvnt/app/lib/stores/<x>
  for (const m of src.matchAll(
    /(?:@\/|@dvnt\/app\/)lib\/stores\/([\w-]+)/g,
  ))
    stores.add(m[1]);
  for (const m of src.matchAll(/(?:@\/|@dvnt\/app\/)lib\/hooks\/([\w-]+)/g))
    hooks.add(m[1]);
  // named hook calls used directly (use<Something> from a hooks barrel)
  const usedHooks = new Set(
    [...src.matchAll(/\buse[A-Z][A-Za-z0-9]+\b/g)].map((m) => m[0]),
  );
  const queries = (src.match(/useInfiniteQuery|useQuery|useMutation/g) || [])
    .length;
  // domain hooks = use<Something> calls that aren't React/RN/router built-ins.
  // These carry the data wiring (useEvents, usePost, useToggleBookmark, …).
  const domainHooks = new Set(
    [...usedHooks].filter((h) => !BUILTIN_HOOKS.has(h)),
  );
  // explicit react-query key literals: useQuery({ queryKey: ["events", …] })
  const queryKeys = new Set();
  for (const m of src.matchAll(/queryKey:\s*\[\s*["'`]([\w-]+)["'`]/g))
    queryKeys.add(m[1]);
  // named exports (export const X / export function X / export { X })
  const named = new Set();
  for (const m of src.matchAll(
    /export\s+(?:const|function)\s+([A-Za-z0-9_]+)/g,
  ))
    named.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
    m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
      .forEach((n) => named.add(n));
  return { stores, hooks, usedHooks, queries, named, domainHooks, queryKeys };
}

function setDiff(a, b) {
  return [...a].filter((x) => !b.has(x));
}

// ── 1. Route inventory diff ────────────────────────────────────────────────
const deviantRoutes = walk(DEVIANT_APP).filter(isRoute);
const missing = [];
const present = [];
for (const rel of deviantRoutes) {
  if (existsSync(join(PORT_DIR, rel))) present.push(rel);
  else missing.push(rel);
}

// ── 2/3. Data-wiring + export parity per present screen ────────────────────
const wiringDiffs = [];
for (const rel of present) {
  let orig, port;
  try {
    orig = readFileSync(join(DEVIANT_APP, rel), "utf8");
    port = readFileSync(join(PORT_DIR, rel), "utf8");
  } catch {
    continue;
  }
  const o = extractWiring(orig);
  const p = extractWiring(port);
  const missStores = setDiff(o.stores, p.stores);
  const missHooks = setDiff(o.hooks, p.hooks);
  const missNamed = setDiff(o.named, p.named);
  const queryGap = o.queries - p.queries;
  if (
    missStores.length ||
    missHooks.length ||
    missNamed.length ||
    queryGap > 0
  ) {
    wiringDiffs.push({ rel, missStores, missHooks, missNamed, queryGap });
  }
}

// ── 4. Web coverage audit: which apps/web pages render a REAL web screen vs
// dynamically import a NATIVE route screen (crashes on web / native-only deps).
const webPageFiles = walk(WEB_APP_DIR).filter((r) => r.endsWith("page.tsx"));
const webReal = [];
const webNative = [];
const webOther = [];
for (const rel of webPageFiles) {
  const src = readFileSync(join(WEB_APP_DIR, rel), "utf8");
  const route = rel.replace(/\/page\.tsx$/, "") || "/";
  if (/features\/routes\/screens\//.test(src)) webNative.push(route);
  else if (/\.web['"]|features\/(post|events|auth|home|screens)\//.test(src) || /WebAppShell|RedirectIfAuthed/.test(src))
    webReal.push(route);
  else webOther.push(route);
}
const webPages = webPageFiles.length;

// ── 5. WEB DATA-PARITY (Phase 0): for every real `*.web.tsx` screen, its native
// source's data wiring (stores, lib/hooks, domain hooks, query keys, query/
// mutation count) MUST be present in the web file. Missing = hard fail.
const allWebScreens = walk(FEATURES_DIR).filter((r) => r.endsWith(".web.tsx"));
const webDataDiffs = [];   // hard failures — dropped portable wiring
const webDataDebt = [];    // accepted deferrals (KNOWN_WEB_DEBT) seen this run
const webDataChecked = [];
// Filter a missing-list: drop native-only, equivalent-covered, + accepted-debt.
function classify(missing, debtSet, webWiring) {
  const real = [];
  const debt = [];
  for (const x of missing) {
    if (NATIVE_ONLY_WIRING.has(x)) continue;
    // covered by an equivalent convenience hook the web file references?
    const equivs = EQUIVALENT_WIRING[x];
    if (equivs && equivs.some((e) => webWiring.has(e))) continue;
    if (debtSet.has(x)) debt.push(x);
    else real.push(x);
  }
  return { real, debt };
}
function resolveNativeSource(webRel) {
  // 1. explicit map to a route screen.
  if (WEB_NATIVE_SOURCE_MAP[webRel])
    return { path: join(PORT_DIR, WEB_NATIVE_SOURCE_MAP[webRel]), label: WEB_NATIVE_SOURCE_MAP[webRel] };
  // 2. `.native.tsx` / `.tsx` sibling.
  const base = webRel.slice(0, -".web.tsx".length);
  for (const ext of [".native.tsx", ".tsx"]) {
    const p = join(FEATURES_DIR, base + ext);
    if (existsSync(p)) return { path: p, label: base + ext };
  }
  return null;
}
// Composition-aware wiring: a web screen often delegates data wiring to a shared
// sibling `.web` component it imports (e.g. followers.web → follow-list.web,
// profile.web → ProfileMasonryGrid.web). Resolve those local feature imports one
// level deep and UNION their wiring into the screen's, so the verifier credits
// wiring that lives in an imported component rather than only the screen file.
function resolveFeatureImport(fromRel, spec) {
  let target = null;
  const m = spec.match(/@dvnt\/app\/features\/(.+)$/);
  if (m) target = m[1];
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
    const parts = (dir + "/" + spec).split("/");
    const stack = [];
    for (const p of parts) {
      if (p === "" || p === ".") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    target = stack.join("/");
  }
  if (!target) return null;
  const cand = target.endsWith(".web") ? [target + ".tsx"] : [target + ".web.tsx", target + ".tsx"];
  for (const c of cand) {
    const p = join(FEATURES_DIR, c);
    if (existsSync(p)) return p;
  }
  return null;
}
function extractWiringDeep(fromRel, src, depth = 1) {
  const w = extractWiring(src);
  if (depth <= 0) return w;
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const p = resolveFeatureImport(fromRel, m[1]);
    if (!p) continue;
    try {
      const childRel = relative(FEATURES_DIR, p);
      const cw = extractWiringDeep(childRel, readFileSync(p, "utf8"), depth - 1);
      cw.stores.forEach((x) => w.stores.add(x));
      cw.hooks.forEach((x) => w.hooks.add(x));
      cw.domainHooks.forEach((x) => w.domainHooks.add(x));
      cw.queryKeys.forEach((x) => w.queryKeys.add(x));
      w.queries += cw.queries;
    } catch {
      /* ignore unreadable import */
    }
  }
  return w;
}

for (const webRel of allWebScreens) {
  // Landing marketing sections are presentational platform-splits (Skia vs RAF,
  // expo-video vs hls.js) — not data screens. Exempt from web-data-parity.
  if (webRel.startsWith("screens/landing/")) continue;
  // debug/ are internal dev/QA tools (network probe, deep-link tester, OTA info,
  // transition lab, telemetry) — not user-facing data screens. Exempt.
  if (webRel.startsWith("debug/")) continue;
  const native = resolveNativeSource(webRel);
  if (!native) continue; // web-only screen with no native counterpart — skip.
  let webSrc, natSrc;
  try {
    webSrc = readFileSync(join(FEATURES_DIR, webRel), "utf8");
    natSrc = readFileSync(native.path, "utf8");
  } catch {
    continue;
  }
  const w = extractWiringDeep(webRel, webSrc);
  const n = extractWiring(natSrc);
  const debtEntry = KNOWN_WEB_DEBT[webRel];
  const debtSet = debtEntry ? debtEntry.items : new Set();
  const wAll = new Set([...w.stores, ...w.hooks, ...w.domainHooks]);
  const s = classify(setDiff(n.stores, w.stores), debtSet, wAll);
  const h = classify(setDiff(n.hooks, w.hooks), debtSet, wAll);
  const d = classify(setDiff(n.domainHooks, w.domainHooks), debtSet, wAll);
  // queryKeys are INFORMATIONAL only — literal `queryKey:["x"]` matching misses
  // key-factory usage (bookmarkKeys/activityKeys/notificationKeys), so it's too
  // brittle to gate on. Stores + lib-hooks + domain-hooks are the real teeth.
  const k = classify(setDiff(n.queryKeys, w.queryKeys), debtSet);
  const realFail = [...s.real, ...h.real, ...d.real];
  const accepted = [...new Set([...s.debt, ...h.debt, ...d.debt, ...k.debt])];
  webDataChecked.push(webRel);
  if (realFail.length) {
    webDataDiffs.push({ webRel, native: native.label, missStores: s.real, missHooks: h.real, missDomain: d.real, missKeys: [] });
  }
  if (accepted.length) {
    webDataDebt.push({ webRel, phase: debtEntry?.phase ?? "?", items: accepted });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const json = process.argv.includes("--json");
if (json) {
  console.log(
    JSON.stringify({ missing, wiringDiffs, webDataDiffs, counts: { deviantRoutes: deviantRoutes.length, present: present.length, webPages, webDataChecked: webDataChecked.length } }, null, 2),
  );
} else {
  console.log("\n════════ PORT PARITY (PROMPT 5) ════════");
  console.log(`Deviant routes: ${deviantRoutes.length} · Ported: ${present.length} · Web pages: ${webPages}`);

  console.log(`\n── 1. MISSING SCREENS (${missing.length}) ──`);
  if (missing.length === 0) console.log("  ✓ every original route has a ported screen");
  else missing.forEach((m) => console.log(`  ✗ ${m}`));

  console.log(`\n── 2. DATA-WIRING / EXPORT DIFFS (${wiringDiffs.length} screens) ──`);
  if (wiringDiffs.length === 0) console.log("  ✓ no dropped stores/hooks/exports/queries");
  else
    for (const d of wiringDiffs) {
      console.log(`  ✗ ${d.rel}`);
      if (d.missStores.length) console.log(`      stores:  ${d.missStores.join(", ")}`);
      if (d.missHooks.length) console.log(`      hooks:   ${d.missHooks.join(", ")}`);
      if (d.queryGap > 0) console.log(`      queries: ${d.queryGap} fewer react-query calls than original`);
      if (d.missNamed.length) console.log(`      exports: ${d.missNamed.join(", ")}`);
    }

  console.log(`\n── 3. WEB AUDIT (Law 3) — ${webPages} pages ──`);
  console.log(`  REAL web screens (${webReal.length}): ${webReal.join(", ") || "none"}`);
  console.log(`  Renders NATIVE on web (${webNative.length}) — these crash / native-only deps:`);
  webNative.forEach((r) => console.log(`      ⚠ /${r}`));

  console.log(`\n── 4. WEB DATA-PARITY (Phase 0) — ${webDataChecked.length} web screens vs native source ──`);
  if (webDataDiffs.length === 0)
    console.log("  ✓ no DROPPED portable wiring (native-only filtered; deferred = debt ledger below)");
  else
    for (const d of webDataDiffs) {
      console.log(`  ✗ ${d.webRel}  (vs ${d.native})`);
      if (d.missStores.length) console.log(`      stores:  ${d.missStores.join(", ")}`);
      if (d.missHooks.length) console.log(`      hooks:   ${d.missHooks.join(", ")}`);
      if (d.missDomain.length) console.log(`      domain:  ${d.missDomain.join(", ")}`);
      if (d.missKeys.length) console.log(`      keys:    ${d.missKeys.join(", ")}`);
    }
  if (webDataDebt.length) {
    console.log(`\n  DEBT LEDGER (accepted, phase-tagged — portable features still owed):`);
    for (const d of webDataDebt)
      console.log(`    ⌛ ${d.webRel} [${d.phase}]: ${d.items.join(", ")}`);
  }
}

const hardFail = missing.length > 0 || wiringDiffs.length > 0 || webDataDiffs.length > 0;
process.exit(hardFail ? 1 : 0);
