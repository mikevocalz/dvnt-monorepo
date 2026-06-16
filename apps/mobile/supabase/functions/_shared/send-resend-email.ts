/**
 * Shared Resend email helper for edge functions.
 *
 * Centralises the RESEND_API_KEY / RESEND_FROM_EMAIL env read, the POST
 * to api.resend.com, and the brand-styled HTML wrapper. Call it from any
 * edge fn that needs to send a transactional email (guest tickets,
 * receipts, confirmations, etc).
 *
 *   await sendResendEmail({
 *     to: "you@example.com",
 *     subject: "...",
 *     html: brandEmailWrapper(`<h1>...</h1>...`),
 *   });
 *
 * Returns the Resend message id. Throws on non-2xx.
 * Logs and returns null if RESEND_API_KEY isn't configured — so a
 * misconfigured dev env doesn't crash downstream flows.
 */

import { brandEmailWrapper } from "./email/wrapper.ts";

const APP_NAME = "DVNT";

// Re-export the upgraded brand shell so every existing
// `import { sendResendEmail, brandEmailWrapper } from "../_shared/send-resend-email.ts"`
// call site automatically picks up the new landing-grade design. The full kit
// (components, templates, tokens) lives in ./email/.
export { brandEmailWrapper };
export * from "./email/templates.ts";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional from override (defaults to RESEND_FROM_EMAIL). */
  from?: string;
}

export async function sendResendEmail(
  args: SendEmailArgs,
): Promise<string | null> {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) {
    console.warn("[send-resend-email] RESEND_API_KEY missing — skipping send");
    return null;
  }
  const from =
    args.from ||
    Deno.env.get("RESEND_FROM_EMAIL") ||
    `${APP_NAME} <onboarding@resend.dev>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  const json = await res.json().catch(() => ({}));
  return typeof json.id === "string" ? json.id : null;
}
