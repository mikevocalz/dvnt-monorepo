/**
 * Where "More events" goes, and who it belongs to.
 *
 * Kept out of the components so native and web cannot drift: both cards route
 * through `hostEventsHref`, and both decide between a direct link and a picker
 * through `needsHostPicker`.
 */

export interface ResolvedHost {
  username: string;
  name: string;
  avatar?: string;
  /** "Host" / "Co-host" — displayed verbatim, never inferred from the data. */
  role: string;
}

interface HostInput {
  username: string;
  name?: string;
  avatar?: string;
  role?: string;
}

/**
 * The host's events tab. "More events" promises this person's events, so the
 * profile root — which opens on their posts — reads as a broken link.
 */
export function hostEventsHref(username: string, opts?: { web?: boolean }): string {
  const handle = encodeURIComponent(username);
  return opts?.web
    ? `/profile/${handle}?tab=events`
    : `/(protected)/profile/${handle}?tab=events`;
}

/**
 * Host first, then co-hosts in billing order. Drops entries with no username
 * (nothing to route to) and any co-host repeating the host, so the picker never
 * offers the same person twice or a blank row.
 */
export function resolveHosts(
  host: HostInput,
  coHosts: HostInput[] | undefined,
): ResolvedHost[] {
  const seen = new Set<string>();
  const out: ResolvedHost[] = [];

  for (const [index, entry] of [host, ...(coHosts ?? [])].entries()) {
    const username = entry?.username?.trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      name: entry.name?.trim() || username,
      avatar: entry.avatar,
      role: entry.role || (index === 0 ? "Host" : "Co-host"),
    });
  }

  return out;
}

/** A picker holding one option is a question with a single answer. */
export function needsHostPicker(hosts: ResolvedHost[]): boolean {
  return hosts.length > 1;
}
