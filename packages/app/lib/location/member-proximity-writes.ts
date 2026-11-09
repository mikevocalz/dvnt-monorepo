// A single queue across feed/settings publishers and exact consent operations.
// A queued withdrawal must always run after an older publication has settled.
const queue: { current: Promise<unknown> } = { current: Promise.resolve() };
export function serializeProximityWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.current.catch(() => {}).then(operation);
  queue.current = result;
  return result;
}
