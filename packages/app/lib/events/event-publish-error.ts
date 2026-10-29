/** Preserve an explicit server refusal; never infer it from timeout/message text. */
export function eventPublishError(error?: { message?: string; code?: string; status?: number } | null): Error & { code?: string; status?: number } {
  return Object.assign(new Error(error?.message || "Failed to create event"), {
    code: error?.code,
    status: error?.status,
  });
}
export function shouldDiscardPreparedRoom(error: unknown, attempt: { authId?: string | null; requestId: string }, current: {
  authId?: string | null;
  preparedRoom: { authId: string; requestId: string } | null;
}): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "room_unavailable" &&
    !!attempt.authId && current.authId === attempt.authId &&
    current.preparedRoom?.authId === attempt.authId && current.preparedRoom.requestId === attempt.requestId;
}
