#!/usr/bin/env node
/**
 * verify-realtime-channels — fails if a resubscribable realtime channel is
 * opened with `supabase.channel()` instead of `freshChannel()`.
 *
 * WHY THIS EXISTS
 *
 * `RealtimeClient.channel(topic)` returns an EXISTING channel when one is
 * already registered for that topic, and `RealtimeChannel.on()` throws if the
 * channel it is handed has already joined:
 *
 *     cannot add `postgres_changes` callbacks for <topic> after `subscribe()`
 *
 * Because that throw happens inside an effect, it takes down whatever subtree
 * the hook lives in. It killed the entire (protected) layout (inbox included)
 * once, and the Call screen once.
 *
 * It shipped THREE times: call_signals, then call_signal_updates, then
 * call_end — because each was fixed as an individual bug and the call sites
 * were audited by hand. This script is the audit, so it cannot be skipped or
 * done sloppily.
 *
 * THE RULE IT ENFORCES, and the distinction that matters:
 *
 *   .on("postgres_changes")            per-client subscription. A unique topic
 *   (and NOT presence/broadcast)       is safe and REQUIRED  -> freshChannel()
 *
 *   .on("presence") / .on("broadcast") peers MUST share a topic to see each
 *                                      other. A unique topic silently isolates
 *                                      every client -> supabase.channel() is
 *                                      correct; guard reuse with a singleton
 *                                      (see lib/hooks/use-presence.ts)
 *
 * A blanket find-and-replace would typecheck and quietly break peer-to-peer
 * messaging, which is exactly why this checks event types rather than call
 * shape.
 *
 * Usage: node scripts/verify-realtime-channels.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// apps/web included, and .web.tsx files are NOT skipped: realtime-js is the
// same library on web, so the throw is identical there. The first version of
// this script excluded them for no reason I could justify, which hid five
// real violations.
const ROOTS = ["packages/app", "apps/mobile", "apps/web"];

function sourceFiles() {
  const out = execFileSync(
    "grep",
    ["-rl", "--include=*.ts", "--include=*.tsx", "\\.channel(", ...ROOTS],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules"))
    .filter((f) => !f.includes("lib/supabase/realtime"));
}

const violations = [];
const sharedTopic = [];

for (const file of sourceFiles()) {
  const src = readFileSync(file, "utf8");
  const re = /\.channel\(/g;
  let m;
  while ((m = re.exec(src))) {
    // Skip matches inside comments — several files legitimately *describe*
    // supabase.channel() in prose explaining this very hazard.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const before = src.slice(lineStart, m.index).trimStart();
    if (before.startsWith("//") || before.startsWith("*") || before.startsWith("/*")) continue;

    const line = src.slice(0, m.index).split("\n").length;
    // The chained expression, up to .subscribe() — that is where .on() lives.
    const end = src.indexOf(".subscribe(", m.index);
    const chunk = src.slice(m.index, end > 0 ? end : m.index + 1500);
    const types = new Set([...chunk.matchAll(/\.on\(\s*"(\w+)"/g)].map((x) => x[1]));

    const isShared = types.has("presence") || types.has("broadcast");
    const isPg = types.has("postgres_changes");

    if (isShared) sharedTopic.push(`${file}:${line} [${[...types].join(",")}]`);
    else if (isPg) violations.push(`${file}:${line} [${[...types].join(",")}]`);
  }
}

if (sharedTopic.length) {
  console.log(
    `ok  ${sharedTopic.length} shared-topic channel(s) correctly using supabase.channel():`,
  );
  for (const s of sharedTopic) console.log(`      ${s}`);
}

if (violations.length) {
  console.error(
    `\nFAIL  ${violations.length} postgres_changes channel(s) using supabase.channel() instead of freshChannel():\n`,
  );
  for (const v of violations) console.error(`      ${v}`);
  console.error(
    `\n      These will throw "cannot add postgres_changes callbacks after subscribe()"\n` +
      `      on any remount that laps its own cleanup, taking their subtree down.\n` +
      `      Fix: import { freshChannel } from "<...>/lib/supabase/realtime" and\n` +
      `      replace supabase.channel(topic) with freshChannel(topic).\n`,
  );
  process.exit(1);
}

console.log("\nok  no raw postgres_changes channels — freshChannel is used everywhere it must be.");
