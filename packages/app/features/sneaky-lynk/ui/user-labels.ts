import type { SneakyUser } from "../types";

type MinimalSneakyUser = Partial<
  Pick<SneakyUser, "username" | "displayName" | "isAnonymous" | "anonLabel">
>;

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
