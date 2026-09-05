import type { CallSignal } from "@dvnt/app/lib/api/call-signals";
export function freshRingingSignal(signal: CallSignal | null, roomId: string, calleeId: string, now = Date.now()): signal is CallSignal {
  if (!signal || signal.status !== "ringing" || signal.room_id !== roomId || String(signal.callee_id) !== calleeId || !["audio", "video"].includes(signal.call_type)) return false;
  const stamp = Date.parse(signal.created_at);
  return Number.isFinite(stamp) && stamp <= now + 5_000 && now - stamp < 30_000;
}
/** Resolves only after the addressed ringing signal was conditionally claimed. */
export async function answerIncomingCall(options: {
  roomId: string; calleeId: string; decision?: "accepted" | "declined"; current: () => boolean;
  fetchSignal: (roomId: string, calleeId: string) => Promise<CallSignal | null>;
  claim: (signalId: number, calleeId: string, roomId: string) => Promise<boolean>;
}): Promise<CallSignal | null> {
  try {
    if (!options.current()) return null;
    const signal = await options.fetchSignal(options.roomId, options.calleeId);
    if (!options.current() || !freshRingingSignal(signal, options.roomId, options.calleeId)) return null;
    if (!await options.claim(signal.id, options.calleeId, options.roomId)) return null;
    if (!options.current()) return null;
    return { ...signal, status: options.decision ?? "accepted" };
  } catch { return null; }
}
