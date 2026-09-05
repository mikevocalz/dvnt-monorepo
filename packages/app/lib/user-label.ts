/**
 * The anonymity-safe display-name rule for the whole app.
 *
 * Lives in lib, not a feature, because BOTH rails had a hand-rolled fallback
 * chain that fell through to a real name whenever anonLabel was missing —
 * Sneaky Lynk's web room and the calls rail's VideoTile / ParticipantsSheet.
 * One rule, one place, so the next surface cannot reinvent it slightly wrong.
 */

/** Structural subset — deliberately not importing a feature's user type, so
 *  any caller with these fields can use it. */
interface MinimalUser {
  username?: string;
  displayName?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

type MinimalSneakyUser = MinimalUser;

export function normalizeSneakyAnonLabel(label?: string | null): string | null {
  if (!label) return null;
  const match = label.match(/anon(?:\s+lynk)?\s+(\d+)/i);
  if (match) return `Anon ${match[1]}`;
  return label.trim() || null;
}

export function getSneakyUserLabel(user?: MinimalSneakyUser | null): string {
  if (!user) return "Guest";

  if (user.isAnonymous) {
    return normalizeSneakyAnonLabel(user.anonLabel) || "Anonymous";
  }

  return user.displayName || user.username || "Guest";
}

export function getSneakyUserHandle(user?: MinimalSneakyUser | null): string | null {
  if (!user) return null;

  if (user.isAnonymous) {
    return normalizeSneakyAnonLabel(user.anonLabel) || null;
  }

  return user.username || null;
}

export function getSneakyUserShortLabel(user?: MinimalSneakyUser | null): string {
  const label = getSneakyUserLabel(user);
  const [firstToken] = label.split(/\s+/);
  return firstToken || label;
}
