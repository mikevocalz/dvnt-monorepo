/**
 * The canonical Deviant sender, resolved from server-only configuration.
 *
 * The real @DeviantEvents account has not been supplied, so every read below
 * fails closed. Nothing resolves a username at send time: a username is
 * mutable and whoever holds it next would inherit the brand's outbox. The
 * immutable pair (users.id, users.auth_id) is the identity.
 *
 * Three environment variables, all required:
 *   DVNT_BRAND_USER_ID          integer public.users.id of the brand account
 *   DVNT_BRAND_AUTH_ID          Better Auth user id of the same account
 *   DVNT_BRAND_OUTBOX_ENABLED   must be exactly "true"
 *
 * The enable flag is separate on purpose. Setting the two IDs is how an
 * operator records who the sender is; flipping the flag is how they decide
 * that real members should start receiving messages. Merging this branch with
 * nothing configured sends nothing.
 *
 * This is for brand announcements only. Event operational notices keep their
 * originating host as actor — see event-broadcast-message, which must not be
 * rewritten to send as the brand account.
 */

export interface BrandSender {
  /** public.users.id — messages.sender_id, blocks.blocker_id. */
  userId: number;
  /** Better Auth user id — conversations_rels.users_id. */
  authId: string;
}

export type BrandSendGate =
  | { ok: true; sender: BrandSender }
  | { ok: false; reason: string };

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

/** The sender identity, or why it could not be resolved. */
export function resolveBrandSender(): BrandSendGate {
  const rawUserId = env("DVNT_BRAND_USER_ID");
  const authId = env("DVNT_BRAND_AUTH_ID");
  if (!rawUserId) return { ok: false, reason: "DVNT_BRAND_USER_ID is not set" };
  if (!authId) return { ok: false, reason: "DVNT_BRAND_AUTH_ID is not set" };
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false, reason: "DVNT_BRAND_USER_ID is not a positive integer" };
  }
  return { ok: true, sender: { userId, authId } };
}

/** Sending gate. Resolved identity AND an explicit enable flag. */
export function brandSendGate(): BrandSendGate {
  const resolved = resolveBrandSender();
  if (!resolved.ok) return resolved;
  if (env("DVNT_BRAND_OUTBOX_ENABLED") !== "true") {
    return { ok: false, reason: "DVNT_BRAND_OUTBOX_ENABLED is not true" };
  }
  return resolved;
}

/**
 * Growth email needs a working unsubscribe path before it can go out. Returns
 * null when unset, and the worker suppresses email rows rather than sending
 * commercial mail nobody can stop.
 * ponytail: one URL for the whole campaign set, no per-recipient token. A
 * tokenized link needs its own public endpoint; the in-app setting is the
 * opt-out that exists today.
 */
export function brandUnsubscribeUrl(): string | null {
  return env("DVNT_BRAND_UNSUBSCRIBE_URL") || null;
}

/**
 * Prove the configured pair is one real account before sending anything.
 *
 * `brandSendGate()` only checks that the two ids are present and well-formed.
 * A typo in either would still be well-formed, and the worker would then send
 * as whatever account that id happens to name. This app has already shipped one
 * incident where content landed under the wrong account because an identity was
 * taken on trust, so the pair is verified against the row rather than assumed.
 *
 * Returns the sender when `users.id` and `users.auth_id` agree, otherwise the
 * reason. Callers treat a failure exactly like an unset variable: send nothing.
 */
export async function verifyBrandSender(
  db: { from: (t: string) => any },
  sender: BrandSender,
): Promise<BrandSendGate> {
  const { data, error } = await db
    .from("users")
    .select("id, auth_id, username")
    .eq("id", sender.userId)
    .maybeSingle();
  if (error) return { ok: false, reason: "Could not read the brand account" };
  if (!data) return { ok: false, reason: `No account with users.id ${sender.userId}` };
  if (String(data.auth_id) !== sender.authId) {
    // Do not log the configured auth id next to the real one; say only that
    // they disagree, and let the operator compare against their own config.
    return {
      ok: false,
      reason: `DVNT_BRAND_AUTH_ID does not belong to users.id ${sender.userId}`,
    };
  }
  return { ok: true, sender };
}
