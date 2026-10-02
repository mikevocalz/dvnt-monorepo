const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;

export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeCompRecipient(raw: unknown): { kind: "email" | "username" | "phone"; value: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.startsWith("@") && PHONE_LIKE.test(text)) {
    const phone = normalizePhoneE164(text);
    return phone ? { kind: "phone", value: phone } : null;
  }
  if (text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
    return { kind: "email", value: text.toLowerCase() };
  const username = text.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{2,40}$/.test(username)
    ? { kind: "username", value: username.toLowerCase() } : null;
}

export type CompRoute =
  | { route: "member" }
  | { route: "guest"; email: string }
  | { route: "phone_guest"; phone: string }
  | { route: "skip"; reason: string };

/**
 * Decides where one recipient goes, given the account the caller resolved for
 * it (null when the lookup found nothing). An email with no account is a guest
 * comp delivered by email; a username with no account is a dead end, because a
 * handle is not an address we can send anything to.
 */
export function routeCompRecipient(
  raw: unknown,
  account: { authId?: string | null } | null | undefined,
): CompRoute {
  const norm = normalizeCompRecipient(raw);
  if (!norm) {
    const text = typeof raw === "string" ? raw.trim() : "";
    return {
      route: "skip",
      reason:
        !text.startsWith("@") && PHONE_LIKE.test(text)
          ? "Phone number must be a valid US number or E.164 international number"
          : "Not a DVNT username, valid email address, or valid phone number",
    };
  }
  if (account?.authId) return { route: "member" };
  if (norm.kind === "email") return { route: "guest", email: norm.value };
  if (norm.kind === "phone") return { route: "phone_guest", phone: norm.value };
  return {
    route: "skip",
    reason: "No DVNT account with that username; use their email or phone to send a guest ticket",
  };
}

export type CompDeliveryStatus = "delivered" | "failed";

/**
 * A guest ticket exists the moment the RPC commits; the email is a separate
 * step that can fail on its own. Keep the two apart so a host never reads
 * "issued" as "they got it".
 */
export function summarizeCompDelivery(
  sends: { recipient: string; delivered: boolean; error?: string | null }[],
) {
  const results = sends.map((send) => ({
    recipient: send.recipient,
    status: (send.delivered ? "delivered" : "failed") as CompDeliveryStatus,
    ...(send.delivered ? {} : { error: send.error || "Email delivery failed" }),
  }));
  return {
    delivered: results.filter((r) => r.status === "delivered").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
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
