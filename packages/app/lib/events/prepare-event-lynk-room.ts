/** Reuse a successfully prepared private room if publishing the event fails.
 * Pending work stays single-flight even if the UI unmounts. This is not a
 * server transaction: a lost room-create response still needs server-side
 * idempotency; never claim an event was published without its requested room.
 */
type PreparedRoom = { requestId: string; authId: string; roomId: string };
type State = { getPublishRequestId(): string; preparedLynkRoom: PreparedRoom | null };
const pending = new Map<string, Promise<string>>();
async function waitForRoom(operation: Promise<string>, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Room setup is taking longer than expected. Your event has not been published. Retry to check the same request.")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export async function prepareEventLynkRoom(options: {
  authId: string | null | undefined;
  expectedRequestId?: string;
  getState(): State;
  currentAuthId?(): string | null | undefined;
  timeoutMs?: number;
  save(room: PreparedRoom): void;
  create(): Promise<{ ok: boolean; data?: { room?: { id?: string | number } }; error?: { message?: string } }>;
}): Promise<string> {
  if (!options.authId) throw new Error("Sign in again before publishing your Sneaky Lynk event.");
  const authId = options.authId;
  const state = options.getState();
  const requestId = state.getPublishRequestId();
  if (options.expectedRequestId && requestId !== options.expectedRequestId) {
    throw new Error("Your event draft changed. Review the current draft before publishing.");
  }
  const saved = state.preparedLynkRoom;
  if (saved?.authId === authId && saved.requestId === requestId) return saved.roomId;
  const key = `${authId}:${requestId}`;
  const existing = pending.get(key);
  if (existing) return waitForRoom(existing, options.timeoutMs ?? 20_000);
  const operation = (async () => {
    const result = await options.create();
    if (!result.ok || !result.data?.room?.id) {
      throw new Error(result.error?.message || "Your Sneaky Lynk room could not be prepared. Your event has not been published. Please retry.");
    }
    const roomId = String(result.data.room.id);
    // Do not overwrite a new draft if the user navigated away while waiting.
    if (options.getState().getPublishRequestId() !== requestId || (options.currentAuthId && options.currentAuthId() !== authId)) {
      throw new Error("Your account or event draft changed. Review the current draft before publishing.");
    }
    options.save({ requestId, authId, roomId });
    return roomId;
  })();
  pending.set(key, operation);
  void operation.then(() => pending.delete(key), () => pending.delete(key));
  return waitForRoom(operation, options.timeoutMs ?? 20_000);
}
