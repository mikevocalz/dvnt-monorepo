import { computeProfileCompletion } from "../stores/profile-completion.ts";

export type CompletionProfile = NonNullable<Parameters<typeof computeProfileCompletion>[0]> & {
  id?: string | number;
};
export interface CompletionPresence {
  hasIdentity: boolean;
  hasEventAudience: boolean;
}

/** Public profile responses deliberately omit private preferences. Only a
 * successful owner read can call them present or missing. Failed/pending reads
 * must not become a fabricated 70% score. Explicit saved empty values win. */
export function completionFromSources(
  user: CompletionProfile | null,
  profile: CompletionProfile | null | undefined,
  presence: CompletionPresence | null | undefined,
) {
  if (!user || !presence) return null;
  const sameOwner = profile?.id != null && String(profile.id) === String(user.id);
  const publicFields: CompletionProfile = {};
  if (sameOwner) {
    for (const key of ["avatar", "bio", "location", "website", "links"] as const) {
      const value = profile[key];
      if (value !== undefined) Object.assign(publicFields, { [key]: value });
    }
  }
  return computeProfileCompletion({ ...user, ...publicFields }, presence);
}
