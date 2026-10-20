/** Only unresolved operation identities, never media, captions or author data. */
const STORAGE_KEY = "dvnt:pending-story-shares:v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SavedOperation = { key: string; id: string; createdAt: number };
type Operation = SavedOperation & { inFlight: boolean };
const operations = new Map<string, Operation>();

function readSaved(): SavedOperation[] {
  try {
    const raw: unknown = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw
      .filter(
        (item): item is SavedOperation =>
          !!item &&
          typeof item.key === "string" &&
          item.key.length <= 512 &&
          typeof item.id === "string" &&
          UUID.test(item.id) &&
          typeof item.createdAt === "number" &&
          Number.isFinite(item.createdAt) &&
          item.createdAt <= now &&
          now - item.createdAt < MAX_AGE,
      )
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}
function writeSaved(entries: SavedOperation[]) {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    /* private browsing / storage disabled */
  }
}

export function startStoryShareOperation(key: string): Operation | null {
  const now = Date.now();
  for (const [oldKey, operation] of operations) {
    if (!operation.inFlight && now - operation.createdAt >= MAX_AGE)
      operations.delete(oldKey);
  }
  const saved = readSaved();
  let operation = operations.get(key);
  if (operation?.inFlight) return null;
  if (!operation) {
    const previous = saved.find((entry) => entry.key === key);
    operation = {
      ...(previous || { key, id: crypto.randomUUID(), createdAt: now }),
      inFlight: false,
    };
    operations.set(key, operation);
  }
  operation.inFlight = true;
  writeSaved([
    ...saved.filter((entry) => entry.key !== key),
    { key, id: operation.id, createdAt: operation.createdAt },
  ]);
  // Bound memory too, preserving any requests currently in flight.
  for (const [oldKey, entry] of operations) {
    if (operations.size <= MAX_ENTRIES) break;
    if (!entry.inFlight) operations.delete(oldKey);
  }
  return operation;
}

export function finishStoryShareOperation(
  operation: Operation,
  confirmed: boolean,
) {
  operation.inFlight = false;
  if (confirmed) {
    operations.delete(operation.key);
    writeSaved(readSaved().filter((entry) => entry.key !== operation.key));
  }
}
