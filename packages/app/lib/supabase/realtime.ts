/**
 * freshChannel — the only safe way to open a realtime channel you resubscribe to.
 *
 * WHY THIS EXISTS
 *
 * `RealtimeClient.channel(topic)` does NOT always create a channel. Verified in
 * @supabase/realtime-js:
 *
 *   channel(topic, params) {
 *     const realtimeTopic = `realtime:${topic}`
 *     const exists = this.getChannels().find((c) => c.topic === realtimeTopic)
 *     if (!exists) { ...create... } else { return exists }   // <-- reuse
 *   }
 *
 * and `RealtimeChannel.on()` throws outright if the channel it is handed has
 * already joined:
 *
 *   const stateCheck = this.channelAdapter.isJoined() || this.channelAdapter.isJoining()
 *   if (stateCheck && typeCheck) throw new Error(
 *     `cannot add \`postgres_changes\` callbacks for ${this.topic} after \`subscribe()\`.`)
 *
 * So the ordinary `supabase.channel(STABLE_TOPIC).on(...).subscribe()` pattern is
 * a live grenade: the first mount is fine, and any remount that laps its own
 * cleanup gets the still-joined channel back and throws. Because that throw
 * happens inside an effect, it takes down whatever subtree the hook lives in —
 * in this app that was the entire (protected) layout, inbox included.
 *
 * `removeChannel()` cannot prevent it. It is `async` (it awaits
 * channel.unsubscribe() before teardown), so the channel is still in
 * getChannels() on the very next synchronous line.
 *
 * THE FIX
 *
 * A per-subscription unique topic can never collide with a joined channel, and
 * stale siblings are swept first so repeated remounts cannot stack duplicate
 * listeners and deliver the same row twice.
 *
 * This shipped twice as separate one-off patches (`call_signals`, then
 * `call_signal_updates`) before being made shared. Several other call sites
 * independently worked around it with `${Date.now()}` suffixes — the same idea,
 * reinvented. Use this instead of inventing a third variant.
 *
 * WHEN YOU DO NOT NEED THIS: a channel opened once for the lifetime of a screen
 * that never resubscribes is fine with a stable topic. The hazard is specifically
 * resubscription — anything in a hook with deps, or in a layout that remounts.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";

/**
 * Bind freshChannel to a specific client.
 *
 * The sweep below reads `client.getChannels()` and opens on that same client,
 * so the binding is load-bearing: a freshChannel bound to a different client
 * than the caller subscribes with would sweep the wrong channel list and hand
 * back a channel nothing else in the app is listening on. `apps/mobile` keeps
 * its own client, which is why this is a factory rather than a re-export.
 */
export function makeFreshChannel(client: SupabaseClient) {
  let seq = 0;

  /**
   * Open a realtime channel that is guaranteed not to be an already-joined one.
   *
   * @param prefix Stable, human-readable topic prefix, e.g. `call_signals:77`.
   *               A unique suffix is appended; sweep matches on this prefix, so
   *               keep it specific enough not to catch other users' channels.
   * @param config Optional channel config, forwarded to client.channel().
   */
  return function freshChannel(
    prefix: string,
    config?: Parameters<typeof client.channel>[1],
  ): RealtimeChannel {
    // Sweep siblings from earlier mounts. Fire-and-forget: removeChannel is async
    // and we must not await here — the whole point is that the topic we are about
    // to open is different from theirs, so we do not need them gone first.
    for (const c of client.getChannels()) {
      if (
        c.topic === `realtime:${prefix}` ||
        c.topic.startsWith(`realtime:${prefix}:`)
      ) {
        void client.removeChannel(c);
      }
    }

    const topic = `${prefix}:${++seq}`;
    return config ? client.channel(topic, config) : client.channel(topic);
  };
}

export const freshChannel = makeFreshChannel(supabase);

export { bindMessageChanges } from "./message-realtime";
