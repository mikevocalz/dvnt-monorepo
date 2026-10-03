/**
 * Phone for signed-in buyers. The checkout functions refuse a buyer whose
 * account has no phone on file with PHONE_REQUIRED_MESSAGE; the app then
 * shows the phone field and sends the number with the retry. The server
 * stores it (ensure_member_phone); nothing here writes a table.
 */
import {
  PHONE_REQUIRED_CODE,
  PHONE_REQUIRED_MESSAGE,
  checkPhone,
} from "./profile-fields.ts";

/** True for the checkout refusal that asks for a phone, by code or message. */
export function isPhoneRequiredError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return error === PHONE_REQUIRED_MESSAGE;
  const e = error as { code?: unknown; message?: unknown; error?: unknown };
  return (
    e.code === PHONE_REQUIRED_CODE ||
    e.message === PHONE_REQUIRED_MESSAGE ||
    e.error === PHONE_REQUIRED_MESSAGE
  );
}

/**
 * What to send. Before the server has asked, nothing is sent. Once it has,
 * the typed number must be valid, or the checkout stops here with a message
 * instead of making a round trip that will be refused.
 */
export function phoneForRequest(
  needed: boolean,
  typed: string,
): { ok: true; phone?: string } | { ok: false; message: string } {
  if (!needed) return { ok: true };
  if (!typed.trim()) return { ok: false, message: PHONE_REQUIRED_MESSAGE };
  const parsed = checkPhone(typed);
  return parsed.ok ? { ok: true, phone: parsed.value } : { ok: false, message: parsed.message };
}
