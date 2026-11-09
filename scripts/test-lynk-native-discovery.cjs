/** Production native discovery card + route callback, synthetic boundaries only. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let now = Date.parse("2026-11-08T12:00:00Z"), monotonic = 1000;
class Clock extends Date { static now() { return now; } }
const performance = { now: () => monotonic };
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment",
} }).outputText;
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
function load(file, imports = {}) {
  const exports = {};
  new Function("exports", "require", "h", "Date", "performance", "globalThis", transpile(read(file)))(exports,
    name => { if (!(name in imports)) throw Error(`Unexpected import: ${name}`); return imports[name]; }, h, Clock, performance, { performance });
  return exports;
}
const policy = load("packages/app/features/sneaky-lynk/discovery-room-state.ts");
const { LiveRoomCard } = load("packages/app/features/sneaky-lynk/ui/LiveRoomCard.tsx", {
  "../discovery-room-state": policy,
  "react-native": { View: "View", Text: "Text", TouchableOpacity: "TouchableOpacity", StyleSheet: { create: x => x } },
  "lucide-react-native": Object.fromEntries(["Video", "Users", "Globe", "Lock", "Headphones", "ArrowUpRight"].map(x => [x, x])),
  "@dvnt/app/components/ui/avatar": { Avatar: "Avatar" },
});
function bind(code, scope) {
  const js = transpile(`(${code})`).trim().replace(/;$/, "");
  return new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
}
const source = read("packages/app/features/routes/screens/(protected)/messages.tsx");
const ast = ts.createSourceFile("messages.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleRoomPress") callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(callback, "load actual native navigation callback");
const navigation = [], toasts = [];
const openRoom = bind(callback, { discoveryRoomState: policy.discoveryRoomState,
  router: { push: value => navigation.push(value) }, showToast: (...args) => toasts.push(args) });
function room(overrides = {}, isCurrent = () => true) {
  const value = { id: "fixture", title: "Synthetic Lynk", topic: "", status: "open", isLive: true,
    availability: "live", presenceKnown: true, observedAt: new Clock(now).toISOString(),
    presenceExpiresAt: new Clock(now + 20_000).toISOString(), requestStartedAt: now,
    requestStartedMonotonic: monotonic, listeners: 2, maxParticipants: 8,
    isPublic: true, hasVideo: false, host: { id: "host", username: "host" }, speakers: [], ...overrides };
  return policy.bindDiscoveryRoom(value, isCurrent);
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text(node.props?.children);
}
function render(value) { return LiveRoomCard({ space: value, onPress: () => openRoom(value) }); }
function assertInert(value, label) {
  const card = render(value);
  assert.equal(card.props.disabled, true, label);
  assert.equal(card.props.accessibilityState.disabled, true);
  assert.ok(text(card).includes(label), text(card));
  assert.doesNotMatch(card.props.accessibilityLabel, /Join|Resume|Check room/);
  const before = navigation.length;
  card.props.onPress(); openRoom(value);
  assert.equal(navigation.length, before, "disabled card and direct callback cannot navigate");
}
const live = room();
const liveCard = render(live);
assert.equal(liveCard.props.disabled, false);
assert.match(text(liveCard), /Live now/); assert.match(text(liveCard), /Join/);
liveCard.props.onPress(); assert.equal(navigation.length, 1);
const full = render(room({ listeners: 8 }));
assert.equal(full.props.disabled, false); assert.match(text(full), /Check room/);
full.props.onPress(); assert.equal(navigation.length, 2, "full rooms reach authoritative admission");
assertInert(room({ status: "ended" }), "Ended");
assertInert(room({ availability: "inactive", isLive: false, isInvited: true }), "Waiting for host");
assertInert(room({ availability: "unknown", presenceKnown: false, isLive: false }), "Status unavailable");
assertInert({ ...live }, "Status unavailable"); // Serialized/raw records cannot inherit proof.
let current = true;
const accountRoom = room({}, () => current), accountCard = render(accountRoom);
current = false; accountCard.props.onPress(); openRoom(accountRoom);
assert.equal(navigation.length, 2, "account change blocks previously rendered callbacks");
now += 21_000; monotonic += 21_000;
liveCard.props.onPress(); openRoom(live);
assert.equal(navigation.length, 2, "expired render cannot navigate without rerender");
assertInert(live, "Status unavailable");
const owner = room({ isOwner: true, isLive: false, availability: "inactive" });
const ownerCard = render(owner);
assert.equal(ownerCard.props.disabled, false); assert.match(text(ownerCard), /Resume/);
ownerCard.props.onPress(); assert.equal(navigation.length, 3, "fresh owner can resume inactive room");
const scheduled = room({ isLive: false, availability: "scheduled", isInvited: true });
assertInert(scheduled, "Scheduled");
assertInert(room({ isOwner: true, isLive: false, availability: "unknown" }), "Status unavailable");
now += 91_000; monotonic += 91_000;
ownerCard.props.onPress(); openRoom(owner);
assert.equal(navigation.length, 3, "stale owner cannot resume through old callbacks");
assertInert(owner, "Inactive");
console.log("PASS production native discovery: live/full admission, inactive invitation, ended/unknown/raw records, expiry, owner resume and account-change callbacks");
