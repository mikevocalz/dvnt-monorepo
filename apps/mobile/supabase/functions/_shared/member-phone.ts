/**
 * Phone for signed-in buyers (checkout). Every signed-in purchase rail calls
 * requireMemberPhone before it creates a payment or issues a free ticket.
 * The number is stored server-side in user_private_profile by
 * ensure_member_phone (20261003180000_checkout_restricted_profiles.sql);
 * the client never writes it.
 *
 * Fails closed: a failed check refuses the checkout instead of letting it
 * through without a phone.
 */
import {
  PHONE_REQUIRED_CODE,
  PHONE_REQUIRED_MESSAGE,
  checkPhone,
  checkEmail,
} from "./checkout-profile-fields.ts";

export type MemberPhoneResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

// deno-lint-ignore no-explicit-any
type Db = any;

export async function requireMemberPhone(
  db: Db,
  authId: string,
  rawPhone: unknown,
  logPrefix: string,
): Promise<MemberPhoneResult> {
  let phone: string | null = null;
  if (typeof rawPhone === "string" && rawPhone.trim() !== "") {
    const parsed = checkPhone(rawPhone);
    if (!parsed.ok) {
      return { ok: false, status: 400, code: parsed.code, message: parsed.message };
    }
    phone = parsed.value;
  }

  const { data, error } = await db.rpc("ensure_member_phone", {
    p_auth_id: authId,
    p_phone_e164: phone,
  });
  if (error) {
    console.error(`${logPrefix} ensure_member_phone failed:`, error.message);
    return { ok: false, status: 503, code: "unavailable", message: "Couldn't check your profile. Try again." };
  }
  const result = typeof data === "string" ? JSON.parse(data) : data;
  if (result?.ok === true) return { ok: true };
  if (result?.error === PHONE_REQUIRED_CODE) {
    return { ok: false, status: 400, code: PHONE_REQUIRED_CODE, message: PHONE_REQUIRED_MESSAGE };
  }
  if (result?.error === "invalid_phone") {
    const parsed = checkPhone("");
    return { ok: false, status: 400, code: "invalid_phone", message: parsed.ok ? "" : parsed.message };
  }
  console.error(`${logPrefix} ensure_member_phone refused:`, result?.error);
  return { ok: false, status: 409, code: String(result?.error ?? "unknown"), message: "Couldn't save that number. Contact support." };
}

/** Auth is already verified by each Edge caller. Checkout reads canonical
 * member identity and can only fill the caller's existing private phone slot. */
export async function requireWebMemberTicketContact(
  db: Db, authId: string, rawPhone: unknown, logPrefix: string,
): Promise<MemberPhoneResult> {
  const [account, profile] = await Promise.all([
    db.from("user").select("email").eq("id", authId).maybeSingle(),
    db.from("users").select("username").eq("auth_id", authId).maybeSingle(),
  ]);
  if (account.error || profile.error) {
    return { ok: false, status: 503, code: "unavailable", message: "Couldn't check your account. Try again." };
  }
  if (!checkEmail(account.data?.email).ok || typeof profile.data?.username !== "string" ||
      profile.data.username.trim() === "") {
    return { ok: false, status: 400, code: "ticket_account_required",
      message: "Add a valid email and username to your DVNT account before getting a ticket." };
  }
  return requireMemberPhone(db, authId, rawPhone, logPrefix);
}
