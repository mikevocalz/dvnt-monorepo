// A request may still be finishing when its screen unmounts. Keep admission
// and any cancelled-success cleanup in one lane across screen lifetimes, so
// an old leave request cannot remove a newly admitted session in this process.
// This is local serialization, not a backend queue or a seat reservation.
const pending = new Map<string, Promise<void>>();

export function withRoomAdmissionLock<T>(
  owner: string,
  roomId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([owner, roomId]);
  const previous = pending.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => {}, () => {});
  pending.set(key, settled);
  void settled.then(() => {
    if (pending.get(key) === settled) pending.delete(key);
  });
  return result;
}
