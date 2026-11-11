/** Advisory only: scores are not proof of nudity or a safety guarantee. */
export type NudityPrediction = { className: string; probability: number };
export type NudityReview = { flagged: boolean; incomplete: boolean };
export function needsSpicyReview(predictions: NudityPrediction[]): boolean {
  return predictions.some(({ className, probability }) =>
    (className === "Porn" || className === "Hentai") && Number.isFinite(probability) && probability >= 0.65,
  );
}
export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return [0, 0.25, 0.5, 0.75, 0.98].map(fraction => duration * fraction);
}
export function reviewFingerprint(draft: { postKind: string; isNSFW: boolean; selectedMedia: Array<{ id: string; uri: string; editedUri?: string; pairedVideoUri?: string; originalUri?: string; editorOpened?: boolean; kind?: string; type?: string }> }): string {
  return JSON.stringify([draft.postKind, draft.isNSFW, draft.selectedMedia.map(m => [m.id, m.uri, m.editedUri, m.pairedVideoUri, m.originalUri, m.editorOpened, m.kind, m.type])]);
}
