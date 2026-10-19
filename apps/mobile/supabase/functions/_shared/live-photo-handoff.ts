/** Transport validation. Authorization and state transitions also run in the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseLivePhotoHandoff(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request');
  const b = input as Record<string, unknown>;
  const actions = ['create', 'status', 'complete', 'consume', 'cancel'];
  if (typeof b.action !== 'string' || !actions.includes(b.action)) throw new Error('Invalid action');
  const allowed = new Set(['action', 'draftId', ...(b.action === 'create' ? ['maxCount'] : ['id']), ...(b.action === 'complete' ? ['pairs'] : []), ...(b.action === 'consume' ? ['requestId'] : [])]);
  if (Object.keys(b).some(k => !allowed.has(k))) throw new Error('Unexpected request field');
  if (typeof b.draftId !== 'string' || !UUID.test(b.draftId)) throw new Error('Invalid draftId');
  if (b.action !== 'create' && (typeof b.id !== 'string' || !UUID.test(b.id))) throw new Error('Invalid id');
  if (b.action === 'create' && (!Number.isInteger(b.maxCount) || Number(b.maxCount) < 1 || Number(b.maxCount) > 10)) throw new Error('Invalid maxCount');
  if (b.action === 'consume' && (typeof b.requestId !== 'string' || !UUID.test(b.requestId))) throw new Error('Invalid requestId');
  if (b.action === 'complete') {
    if (!Array.isArray(b.pairs) || b.pairs.length < 1 || b.pairs.length > 10) throw new Error('Invalid pairs');
    const seen = new Set<number>();
    for (const p of b.pairs) {
      if (!p || typeof p !== 'object' || Object.keys(p).some(k => k !== 'photoId' && k !== 'motionId')) throw new Error('Invalid pair');
      for (const id of [p.photoId, p.motionId]) {
        if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) throw new Error('Invalid or duplicate media ID');
        seen.add(id);
      }
    }
  }
  return b;
}
