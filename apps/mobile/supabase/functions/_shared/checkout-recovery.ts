/** Identity recovery only. Never authorizes payment or returns provider secrets. */
export const RECOVERY_RESPONSE = { ok: true, message: "If this guest checkout can be recovered, we will email a secure link to its original address." };
export const RECOVERY_TOKEN = /^[a-f0-9]{64}$/;
export const RECOVERY_ORDER = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function recoveryToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function recoveryHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function recoveryEmail(token: string, site: string) {
  // Fixed explicit origins, no arbitrary redirect/site passed by the caller.
  if (!["https://dvntapp.live", "https://dvnt.app"].includes(site) || !RECOVERY_TOKEN.test(token)) throw new Error("Recovery unavailable");
  const url = `${site}/checkout/recovery#token=${token}`;
  return { subject: "Recover your DVNT checkout", html: `<p>You requested access to an unfinished DVNT checkout.</p><p><a href="${url}">Recover checkout</a></p><p>This link expires in 15 minutes and can be used once. Opening it does not charge you or place an order. If you did not request it, ignore this email.</p>` };
}
