/**
 * Edge Function: send-email
 *
 * ⚠️  DEAD CODE — No client or edge function calls this.
 * Better Auth handles transactional email (confirm, reset) directly.
 * Safe to delete once confirmed no future use.
 *
 * Centralized transactional email delivery via Resend.
 * Supports templates: welcome, confirm-email, reset-password.
 *
 * Required Deno env vars:
 *   RESEND_API_KEY        — Resend API token (re_...)
 *   RESEND_FROM_EMAIL     — Verified sender (e.g. DVNT <noreply@dvnt.app>)
 *   (Session verified via direct DB lookup of Better Auth session table)
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type TemplateType = "welcome" | "confirm-email" | "reset-password";

interface SendEmailRequest {
  template: TemplateType;
  to: string;
  /** Dynamic data merged into the template */
  data?: {
    name?: string;
    url?: string;
    /** Token for confirm/reset links (alternative to full url) */
    token?: string;
  };
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  console.error(`[Edge:send-email] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

// ─── Email Templates ─────────────────────────────────────────────────────────

// Re-pointed to the shared kit (../_shared/email) so this (currently dead) path
// can never drift from the branded look every live email uses.
import {
  welcome as kitWelcome,
  verifyEmailLink as kitVerify,
  resetPassword as kitReset,
} from "../_shared/email/templates.ts";

const buildWelcomeEmail = (name: string) => kitWelcome(name);
const buildConfirmEmail = (name: string, url: string) => kitVerify(url, name);
const buildResetPasswordEmail = (url: string) => kitReset(url);

// ─── Auth verification (optional — for authenticated callers) ────────────────

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    // Validate env
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") || "DVNT <onboarding@resend.dev>";

    if (!resendApiKey) {
      return errorResponse(
        "internal_error",
        "RESEND_API_KEY not configured",
        500,
      );
    }

    // Parse body
    let body: SendEmailRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { template, to, data } = body;

    if (!template || !to) {
      return errorResponse(
        "validation_error",
        "template and to are required",
        400,
      );
    }

    if (!["welcome", "confirm-email", "reset-password"].includes(template)) {
      return errorResponse(
        "validation_error",
        `Unknown template: ${template}`,
        400,
      );
    }

    console.log(`[Edge:send-email] Sending ${template} email to ${to}`);

    // Build email content based on template
    let subject: string;
    let html: string;

    switch (template) {
      case "welcome": {
        const email = buildWelcomeEmail(data?.name || "");
        subject = email.subject;
        html = email.html;
        break;
      }
      case "confirm-email": {
        const url = data?.url || "";
        if (!url) {
          return errorResponse(
            "validation_error",
            "data.url is required for confirm-email template",
            400,
          );
        }
        const email = buildConfirmEmail(data?.name || "", url);
        subject = email.subject;
        html = email.html;
        break;
      }
      case "reset-password": {
        const url = data?.url || "";
        if (!url) {
          return errorResponse(
            "validation_error",
            "data.url is required for reset-password template",
            400,
          );
        }
        const email = buildResetPasswordEmail(url);
        subject = email.subject;
        html = email.html;
        break;
      }
      default:
        return errorResponse("validation_error", "Unknown template");
    }

    // Send via Resend REST API (no npm import needed in Deno)
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text();
      console.error(
        `[Edge:send-email] Resend API error (${resendResponse.status}):`,
        errBody,
      );
      return errorResponse(
        "email_delivery_failed",
        `Resend API returned ${resendResponse.status}`,
        502,
      );
    }

    const resendData = await resendResponse.json();
    console.log(
      `[Edge:send-email] ✓ ${template} email sent to ${to}, id: ${resendData.id}`,
    );

    return jsonResponse({
      ok: true,
      data: { messageId: resendData.id, template },
    });
  } catch (err) {
    console.error("[Edge:send-email] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
