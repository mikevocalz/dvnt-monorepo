/** Server age policy. A self-declared DOB is not identity verification. */
export const AGE_REGISTRATION_MESSAGE = "Create your 18+ DVNT account with your date of birth first, then sign in or link Google or Apple.";

/** Called only on user INSERT: existing sign-in and account linking are unaffected. */
export function checkAccountCreationAdmission(path: unknown, body: unknown, email: unknown) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : null;
  if (typeof path !== "string" || path.replace(/\/$/, "") !== "/sign-up/email" ||
      !input || typeof email !== "string" || typeof input.email !== "string" ||
      input.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { allowed: false, code: "AGE_REGISTRATION_REQUIRED", message: AGE_REGISTRATION_MESSAGE };
  }
  return checkAdultBirthDate(input.dateOfBirth);
}

export function parseBirthDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value : null;
}

export function checkAdultBirthDate(value: unknown, now = new Date()): {
  allowed: boolean;
  code: "DATE_OF_BIRTH_REQUIRED" | "INVALID_DATE_OF_BIRTH" | "AGE_RESTRICTED" | null;
  message: string | null;
} {
  if (value === undefined || value === null || value === "") {
    return { allowed: false, code: "DATE_OF_BIRTH_REQUIRED", message: "Enter your date of birth to create an account. DVNT is for adults 18 and older." };
  }
  const dob = parseBirthDate(value);
  if (!dob || !Number.isFinite(now.getTime()) || dob > now.toISOString().slice(0, 10)) {
    return { allowed: false, code: "INVALID_DATE_OF_BIRTH", message: "Enter a valid date of birth in YYYY-MM-DD format." };
  }
  const [year, month, day] = dob.split("-").map(Number);
  const age = now.getUTCFullYear() - year - Number(
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day),
  );
  if (age > 120) return { allowed: false, code: "INVALID_DATE_OF_BIRTH", message: "Enter a valid date of birth." };
  return age >= 18
    ? { allowed: true, code: null, message: null }
    : { allowed: false, code: "AGE_RESTRICTED", message: "You must be 18 or older to create a DVNT account. You can return on your 18th birthday." };
}

export function verificationAgeDecision(status: string, dob: unknown, now = new Date()) {
  if (status !== "passed") return { status, failureCode: null, failureMessage: null };
  const age = checkAdultBirthDate(dob, now);
  if (age.allowed) return { status, failureCode: null, failureMessage: null };
  return {
    status: age.code === "AGE_RESTRICTED" ? "failed" : "review",
    failureCode: age.code === "AGE_RESTRICTED" ? "underage" : "age_evidence_missing",
    failureMessage: age.code === "AGE_RESTRICTED"
      ? "You must be 18 or older to use DVNT."
      : "We need a valid date of birth from your identity document before verification can be approved.",
  };
}
