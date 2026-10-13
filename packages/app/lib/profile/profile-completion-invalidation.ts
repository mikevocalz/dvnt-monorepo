type MemberIdentity = { id?: string; authId?: string } | null | undefined;

const listeners = new Set<(memberId: string) => void>();

/** Invalidate only after a profile/post write has been confirmed by the server. */
export function invalidateProfileCompletion(member: MemberIdentity): void {
  const memberId = member?.authId || member?.id;
  if (memberId) for (const listener of listeners) listener(String(memberId));
}

export function subscribeProfileCompletionInvalidation(
  listener: (memberId: string) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
