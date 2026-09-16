export function normalizeCompRecipient(raw: unknown): { kind: "email" | "username"; value: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  // Phone numbers are not usernames. The current users schema has no verified
  // phone identity; never route a comp to a guessed account from a phone input.
  if (!text.startsWith("@") && /^\+?[\d\s().-]{7,}$/.test(text)) return null;
  if (text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
    return { kind: "email", value: text.toLowerCase() };
  const username = text.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{2,40}$/.test(username)
    ? { kind: "username", value: username.toLowerCase() } : null;
}

export function dedupeCompAccounts<T extends { authId: string; raw: string }>(accounts: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  const skipped: { recipient: string; reason: string }[] = [];
  for (const account of accounts) {
    if (!account.authId || seen.has(account.authId)) {
      skipped.push({ recipient: account.raw, reason: "Same account already included in this batch" });
    } else {
      seen.add(account.authId);
      unique.push(account);
    }
  }
  return { unique, skipped };
}
