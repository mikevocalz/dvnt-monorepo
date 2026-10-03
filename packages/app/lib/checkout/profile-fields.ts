/**
 * Checkout profile fields: username, full name, email and phone.
 *
 * Guest checkout captures these four so the server can create (or reuse) a
 * restricted profile for the buyer. The rules live here once and are copied
 * byte for byte to packages/app/lib/checkout/profile-fields.ts, so the sheet
 * rejects exactly what the server rejects. profile-fields.test.ts fails if the
 * two copies differ. Pure functions only: no Deno, no React, no network.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const FULL_NAME_MAX = 120;
export const EMAIL_MAX = 254;

/** Better Auth's username plugin default character set, lowercased. */
const USERNAME_RE = /^[a-z0-9_.]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Handles that would read as staff or as the brand. The SQL side refuses the
 * same list (checkout_username_available), so the sheet never shows one of
 * these as available.
 */
export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "deviant",
  "deviantevents",
  "dvnt",
  "dvntapp",
  "help",
  "moderator",
  "official",
  "root",
  "security",
  "staff",
  "support",
  "system",
] as const;

export type FieldCode =
  | "invalid_email"
  | "invalid_username"
  | "reserved_username"
  | "invalid_full_name"
  | "invalid_phone"
  | "missing_profile_fields";

export interface FieldError {
  ok: false;
  code: FieldCode;
  message: string;
}

export interface CheckoutProfileFields {
  email: string;
  username: string;
  fullName: string;
  phoneE164: string;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function checkEmail(value: unknown): { ok: true; value: string } | FieldError {
  const email = normalizeEmail(value);
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { ok: false, code: "invalid_email", message: "Enter a valid email." };
  }
  return { ok: true, value: email };
}

/** Lowercase, trimmed, one leading "@" dropped. Never pads or invents characters. */
export function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function checkUsername(value: unknown): { ok: true; value: string } | FieldError {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return {
      ok: false,
      code: "invalid_username",
      message: `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters.`,
    };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Use letters, numbers, underscores and periods only.",
    };
  }
  if (username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
    return {
      ok: false,
      code: "invalid_username",
      message: "A username can't start or end with a period, or repeat one.",
    };
  }
  if ((RESERVED_USERNAMES as readonly string[]).includes(username)) {
    return { ok: false, code: "reserved_username", message: "That username is taken." };
  }
  return { ok: true, value: username };
}

/** Collapses inner whitespace. Mononyms are allowed: one word is a full name. */
export function checkFullName(value: unknown): { ok: true; value: string } | FieldError {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > FULL_NAME_MAX || !/\p{L}/u.test(name)) {
    return { ok: false, code: "invalid_full_name", message: "Enter your full name." };
  }
  return { ok: true, value: name };
}

/**
 * Normalizes to E.164. A number typed with a leading "+" (or "00") keeps its
 * country code. Without one, only North American numbers are accepted: ten
 * digits, or eleven starting with 1. Anything else asks for the country code
 * instead of guessing one.
 */
export function normalizePhoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  // Separators people type: spaces, dashes, dots, parentheses.
  if (/[^\d\s().+-]/.test(raw)) return null;
  const international = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "");
  if (raw.indexOf("+") > 0 || (raw.match(/\+/g) ?? []).length > 1) return null;
  let candidate: string;
  if (international) {
    candidate = `+${raw.startsWith("00") ? digits.slice(2) : digits}`;
  } else if (digits.length === 10) {
    candidate = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidate = `+${digits}`;
  } else {
    return null;
  }
  return E164_RE.test(candidate) ? candidate : null;
}

export function checkPhone(value: unknown): { ok: true; value: string } | FieldError {
  const phone = normalizePhoneE164(value);
  if (!phone) {
    return {
      ok: false,
      code: "invalid_phone",
      message: "Enter a mobile number. Outside the US and Canada, start with + and your country code.",
    };
  }
  return { ok: true, value: phone };
}

/**
 * Reads the profile fields off a checkout request body.
 *
 * `fields: null` means the request carried none of them: an app build from
 * before this change. The caller keeps the old guest checkout for that case
 * and creates no profile. Any field present means all four are required.
 */
export function parseCheckoutProfileFields(
  body: Record<string, unknown> | null | undefined,
  emailKey = "guest_email",
): { ok: true; fields: CheckoutProfileFields | null } | FieldError {
  const input = body ?? {};
  const present = ["username", "full_name", "phone"].some((key) => {
    const v = input[key];
    return typeof v === "string" && v.trim() !== "";
  });
  if (!present) return { ok: true, fields: null };

  const email = checkEmail(input[emailKey]);
  if (!email.ok) return email;
  const username = checkUsername(input.username);
  if (!username.ok) return username;
  const fullName = checkFullName(input.full_name);
  if (!fullName.ok) return fullName;
  const phone = checkPhone(input.phone);
  if (!phone.ok) return phone;
  return {
    ok: true,
    fields: {
      email: email.value,
      username: username.value,
      fullName: fullName.value,
      phoneE164: phone.value,
    },
  };
}
