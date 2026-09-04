#!/usr/bin/env node
/**
 * Guards the boundary between two features that share a vocabulary and nothing
 * else, plus the room session machine's transition table.
 *
 * "Room" means two different things in this codebase:
 *   - a PERSONAL CALL (1:1, or a small group started from Messages) — the
 *     `call_rooms` table, `call_create` / `call_join` edge functions, reached at
 *     `/(protected)/call/[roomId]`. FaceTime-shaped. Fishjam SFU.
 *   - a SNEAKY LYNK room — the `video_rooms` table, `video_join_room` edge
 *     function, reached at `/(protected)/sneaky-lynk/room/[id]`. Many-party,
 *     roles, hand queue, entitlement.
 *
 * They were once one stack, and calls routed into Lynk. The split fixed that;
 * these assertions stop it regrowing, because the failure is silent — a call
 * that reaches the Lynk model asks `video_join_room` for a uuid-keyed row a
 * personal call never has, and simply fails to connect.
 *
 *   node scripts/verify-lynk.mjs
 */
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. The personal-calls stack never reaches the Lynk room model -----------
const CALL_STACK = [
  "packages/app/lib/hooks/use-video-call.ts",
  "packages/app/lib/api/call-rooms.ts",
  "packages/app/features/routes/screens/(protected)/call/[roomId].tsx",
  "packages/app/features/call/call.web.tsx",
].filter((p) => existsSync(join(root, p)));
assert.ok(CALL_STACK.length >= 3, "the call stack moved — this check is scanning the wrong files");

const LYNK_ONLY = [
  ["video_join_room", "the Lynk join edge function"],
  ["video_create_room", "the Lynk create edge function"],
  ["sneakyLynkApi", "the Lynk API surface"],
  ["sneaky-lynk/room", "the Lynk room route"],
];
for (const rel of CALL_STACK) {
  const src = strip(read(rel));
  for (const [needle, what] of LYNK_ONLY) {
    assert.ok(
      !src.includes(needle),
      `${rel} reaches ${what} (${needle}). A personal call has no uuid-keyed video_rooms row; this fails to connect rather than erroring loudly.`,
    );
  }
}
console.log(`1. OK — ${CALL_STACK.length} call-stack files are free of the Lynk room model`);

// --- 2. Calls stay on Fishjam ------------------------------------------------
// MoQ is the Sneaky Lynk room transport (docs/lynk-moq-fit.md §6.1-R). Personal
// calls stay on the Fishjam SFU: a 1:1 or 1-to-4 call is interactive and
// mediated, not a broadcast fan-out.
for (const rel of CALL_STACK) {
  const src = strip(read(rel));
  assert.ok(
    !/@moq\/|react-native-moq/.test(src),
    `${rel} imports a MoQ client. Calls are Fishjam; MoQ is the Lynk room transport.`,
  );
}
const callHook = strip(read("packages/app/lib/hooks/use-video-call.ts"));
assert.match(callHook, /callRoomsApi/, "the call hook must use callRoomsApi (call_create / call_join)");
assert.match(callHook, /resolveFishjamAppId/, "calls must resolve a Fishjam app id");
console.log("2. OK — calls are Fishjam, and carry no MoQ client");

// --- 3. Every call entry point targets the call route ------------------------
// Not the Lynk route, and not the (video) alias that redirects into it.
const entryPoints = execFileSync(
  "git",
  ["grep", "-l", "-E", "isOutgoing", "--", "packages/app/features/routes/screens/(protected)/chat", "packages/app/features/call", "packages/app/features/services/callkeep"],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
)
  .trim()
  .split("\n")
  .filter(Boolean);
assert.ok(entryPoints.length > 0, "found no call entry points — the scan drifted");
for (const rel of entryPoints) {
  const src = strip(read(rel));
  // Any navigation carrying isOutgoing is starting a personal call.
  assert.ok(
    !/sneaky-lynk|\(video\)\/room/.test(src),
    `${rel} starts a call but references a Lynk/video-room destination`,
  );
}
console.log(`3. OK — ${entryPoints.length} call entry points route to the call surface`);

// --- 4. The session machine's transition table is exhaustive ------------------
const machine = read("packages/app/features/sneaky-lynk/session/machine.ts");
const states = [...machine.matchAll(/^\s{2}\|\s"(\w+)"/gm)].map((m) => m[1]);
const declaredStates = ["idle", "joining", "connected", "degraded", "reconnecting", "ended"];
for (const s of declaredStates) {
  assert.ok(
    new RegExp(`^\\s{2}${s}:\\s*\\{`, "m").test(machine),
    `state ${s} has no row in the transition table`,
  );
}
const eventTypes = [...machine.matchAll(/\|\s*\{\s*type:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
assert.ok(eventTypes.length >= 10, `parsed only ${eventTypes.length} events — parser drifted`);
for (const e of eventTypes) {
  assert.ok(
    machine.includes(`${e}:`),
    `event ${e} is in the union but appears in no transition — it would be silently ignored everywhere`,
  );
}
console.log(`4. OK — table covers ${declaredStates.length} states and all ${eventTypes.length} events`);

// --- 5. The machine stays transport- and platform-free -----------------------
// Its whole value is that reconnect can be tested without a device or a relay.
// Import statements only — the file's own header names these packages in prose
// precisely to explain that it does not import them.
const imports = [...strip(machine).matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map(
  (m) => m[1],
);
const forbidden = /^(react|react-native|@moq\/|react-native-moq|@fishjam-cloud|expo-|@dvnt\/app)/;
const leaked = imports.filter((spec) => forbidden.test(spec));
assert.deepStrictEqual(
  leaked,
  [],
  `session/machine.ts must run with no platform and no transport, but imports: ${leaked.join(", ")}`,
);
console.log("5. OK — session machine has no platform or transport import");

// --- 6. Promoted components carry the whole four-file shape ------------------
// A half-promotion is worse than none: a missing .web.tsx resolves to the inert
// base and the component silently renders nothing on that platform, which looks
// like a layout bug rather than a missing file.
// Any component with a `.web.tsx` or `.native.tsx` has forked and owes the
// whole shape — whether it lives in @dvnt/ui or a feature's private ui/.
const forked = execFileSync(
  "sh",
  [
    "-c",
    "find packages/ui/src packages/app/features -type f \\( -name '*.web.tsx' -o -name '*.native.tsx' \\) " +
      "-not -path '*/node_modules/*' | sed -E 's/\\.(web|native)\\.tsx$//' | sort -u",
  ],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
assert.ok(forked.length > 0, "found no platform-forked components — the scan drifted");

// A `.types.ts` is how a component declares it has adopted the shape. Those are
// held to all four files; the rest are pre-existing two-file forks and are
// counted, not failed. A check that fails on arrival gets disabled, and then it
// guards nothing — this one holds the line where the line has been drawn.
let adopted = 0;
let legacy = 0;
for (const stem of forked) {
  const name = stem.split("/").pop();
  // Screens fork by platform too, but they are routed rather than imported
  // bare, so they need no inert base. Only component directories qualify.
  if (!/\/(ui|video|components|form|media)\//.test(stem) && !/packages\/ui\/src\/[A-Z]/.test(stem)) {
    continue;
  }
  // Adoption is declared by having BOTH a contract file and a base file. A
  // two-file fork that happens to carry types (and is only ever imported
  // through a platform-specific path) is legacy, not a broken adoption.
  const declaresShape =
    existsSync(join(root, `${stem}.types.ts`)) && existsSync(join(root, `${stem}.tsx`));
  if (!declaresShape) {
    legacy += 1;
    continue;
  }
  adopted += 1;
  for (const suffix of [".types.ts", ".tsx", ".web.tsx", ".native.tsx"]) {
    assert.ok(
      existsSync(join(root, stem + suffix)),
      `${stem} declares the four-file shape but is missing ${name}${suffix} (code-standards §2)`,
    );
  }
  // The base must be inert, or it would render instead of the platform file.
  const base = readFileSync(join(root, `${stem}.tsx`), "utf8");
  assert.match(
    base,
    new RegExp(`export function ${name}\\([^)]*\\):\\s*null`),
    `${name}.tsx must be the inert base (returns null) — Metro/web resolve a platform file`,
  );
}
console.log(
  `6. OK — ${adopted} components hold the four-file shape` +
    ` (${legacy} older two-file forks not yet converted; see docs/structure-target.md §5)`,
);

// --- 7. The session machine and the observability seam are actually used -----
// Both shipped tested and unreferenced for a dozen commits. A state machine
// with 15 passing assertions and no consumer is worse than none: the tests
// read as coverage of behaviour that never runs.
const consumers = (needle, exclude) =>
  execFileSync(
    "sh",
    [
      "-c",
      // --untracked: a new consumer that is not staged yet still counts.
      `git grep -l --untracked ${JSON.stringify(needle)} -- 'packages/app/**/*.ts' 'packages/app/**/*.tsx' || true`,
    ],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes(".test.") && !exclude.test(f));

const machineUsers = consumers("./machine", /session\/machine\.ts$/);
assert.ok(
  machineUsers.length > 0,
  "session/machine.ts has no non-test consumer — it is dead code wearing a test suite",
);

const seamUsers = consumers("enterRoomObservability", /sneaky-lynk\/observability\.ts$/);
assert.ok(
  seamUsers.length > 0,
  "enterRoomObservability is never called — app-hang tracking still runs through a live room",
);

// Both legs, not just one: a seam only one platform honours is a divergence.
// A "leg" CALLS the hook. Importing a type from the module does not make a
// file a room leg — moq-transport.ts imports RoomTransportStatus and is an
// adapter, not a screen.
const sessionLegs = consumers("useRoomSession", /session\/useRoomSession\.ts$/).filter((f) =>
  /useRoomSession\s*\(/.test(strip(read(f))),
);
const hasNative = sessionLegs.some((f) => f.includes("(protected)/sneaky-lynk/room/"));
const hasWeb = sessionLegs.some((f) => f.endsWith("room.web.tsx"));
assert.ok(hasNative, "the native room does not drive the session machine");
assert.ok(hasWeb, "the web room does not drive the session machine");
// Recovery must be ACTED on, not merely tracked. The machine knew the backoff
// and the budget for a dozen commits while nothing called it, and a leg that
// only TRACKS `reconnecting` is back in that state: the banner says
// "Reconnecting" and nothing ever reconnects.
//
// There are now two legitimate ways to act on it, and a leg must do one:
//   - supply `onReconnect` — the native leg does, because `useVideoRoom.join`
//     re-mints the token and re-attaches;
//   - or drive the session from a transport that reconnects ITSELF, which the
//     web room does since it moved to MoQ: `Moq.Connection.Reload` owns
//     recovery, so the leg observes `reconnecting → live` rather than driving
//     it, and a hand-written rejoin would race the transport's own.
const SELF_RECONNECTING = /useLynkBroadcast\s*\(/;
for (const leg of sessionLegs) {
  const src = strip(read(leg));
  assert.ok(
    /onReconnect\s*:/.test(src) || SELF_RECONNECTING.test(src),
    `${leg} drives the session machine but neither supplies onReconnect nor uses a self-reconnecting transport — it would show "Reconnecting" forever without retrying`,
  );
}
// ...and "the transport reconnects itself" is CHECKED, not taken on trust. If
// `Connection.Reload` is ever swapped for a plain connection, the web room
// silently loses recovery — it has no onReconnect to fall back on.
assert.match(
  strip(read("packages/app/lib/lynk/useLynkBroadcast.web.ts")),
  /Connection\.Reload/,
  "useLynkBroadcast.web no longer builds a reconnecting connection, and the web room relies on that INSTEAD of onReconnect",
);
// The heartbeat is the same class of bug the session machine was: an API
// written, exported, and never called. Without a caller every member reports
// no last_seen_at, and video_list_rooms keeps a dead room "Live" for TWELVE
// hours instead of ninety seconds.
const heartbeatCallers = consumers("useRoomHeartbeat", /hooks\/useRoomHeartbeat\.ts$/).filter(
  (f) => /useRoomHeartbeat\s*\(/.test(strip(read(f))),
);
assert.ok(
  heartbeatCallers.length >= 2,
  `both room legs must send presence heartbeats; found ${heartbeatCallers.length} caller(s). Stale rooms stay listed as Live for 12h without them.`,
);
console.log(
  `7. OK — ${sessionLegs.length} legs drive the session AND supply recovery; ${heartbeatCallers.length} send heartbeats; seam has ${seamUsers.length} caller(s)`,
);

// --- 8. Reactions have exactly one renderer per leg -------------------------
// Both legs used to hand the DOM/RN renderer an empty array whenever a WebGPU
// overlay reported itself available, so a canvas that failed to draw made
// reactions silently invisible. Two renderers racing over one signal is the
// bug; a check is cheaper than rediscovering it from a user report.
for (const leg of [
  "packages/app/features/sneaky-lynk/screens/room.web.tsx",
  "packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx",
]) {
  const src = strip(read(leg));
  assert.ok(
    !/GpuReactionOverlay/.test(src),
    `${leg} renders reactions twice — the GPU overlay suppresses the other renderer and vanishes on init failure`,
  );
  assert.ok(
    !/reactions\s*:\s*\[\]|Reactions=\{[^}]*\?\s*\[\]/.test(src),
    `${leg} conditionally blanks its reactions — that is how they disappeared`,
  );
}
console.log("8. OK — one reaction renderer per leg");

console.log("\nverify-lynk: all sections pass");
