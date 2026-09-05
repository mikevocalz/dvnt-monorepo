/**
 * Profile completion — the weighted ring and checklist behind "Finish your
 * profile".
 *
 * Kept out of onboarding-v2-store so it can be tested: the store imports MMKV
 * and React Native, which no plain node runner can load.
 */

// ─── Profile completion (B2 ring/checklist math) ────────────────────────────

export interface CompletionItem {
  key: string;
  label: string;
  /** Route to jump to (web paths; native maps its own). */
  route: string;
  weight: number;
  done: boolean;
}

/**
 * Weighted completion from the authed user. Photo dominates — it's the
 * highest-value missing item at events ("so people recognize you").
 *
 * Every item here must map to a field that edit-profile can actually change,
 * or the checklist asks for something the user cannot give. Pass the canonical
 * profile from the API where one is available and let the auth-store user be
 * the fallback: a persisted store can lag the database and claim a field is
 * missing that was filled in long ago.
 */
export function computeProfileCompletion(user: {
  avatar?: string;
  bio?: string;
  sexuality?: string[];
  eventAudience?: string;
  location?: string;
  links?: string[];
  /** Counts as a link — see the `links` item below. */
  website?: string;
} | null): { percent: number; missing: CompletionItem[] } {
  if (!user) return { percent: 0, missing: [] };
  // edit-profile keeps one link list and a separate website box, and merges the
  // website into `links` when it saves. So a profile whose only link sits in
  // `website` has a link by every meaning the user has — asking again for one
  // is asking for something they already gave.
  const hasLink =
    (user.links?.length ?? 0) > 0 || !!user.website?.trim();
  const items: CompletionItem[] = [
    // `route` is the WEB path. Native has no /feed segment (its edit screen is
    // /(protected)/edit-profile), so the native card maps by `key` instead of
    // pushing this string — see profile-completion-card.native.tsx.
    // Labels say what the user gets, not what the database wants.
    { key: "photo", label: "Add a photo so people recognize you at events", route: "/feed/profile/edit", weight: 30, done: !!user.avatar },
    { key: "bio", label: "Write a short bio", route: "/feed/profile/edit", weight: 20, done: !!user.bio?.trim() },
    { key: "identity", label: "Tell us who you are — private, tailors your events", route: "/feed/profile/edit", weight: 20, done: (user.sexuality?.length ?? 0) > 0 },
    { key: "audience", label: "Choose who you want events with — private", route: "/feed/profile/edit", weight: 10, done: !!user.eventAudience },
    { key: "location", label: "Add your city to see events near you", route: "/feed/profile/edit", weight: 10, done: !!user.location?.trim() },
    { key: "links", label: "Add a link to your profile", route: "/feed/profile/edit", weight: 10, done: hasLink },
  ];
  const percent = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { percent, missing: items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight) };
}
