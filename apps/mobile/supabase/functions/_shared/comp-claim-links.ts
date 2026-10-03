/**
 * Phone comp claim links: the URL a host texts, and what a claim attempt
 * tells the recipient. Pure, so both edge functions and the node tests share
 * one copy.
 */

/** One row of issue_guest_phone_comp_tickets_atomic's `links`. */
export interface IssuedPhoneLink {
  ticket_id: string;
  phone: string;
  token: string;
  expires_at: string;
  reissued: boolean;
}

/** What bulk-comp-tickets returns to the host for each phone. */
export interface CompClaimLink {
  recipient: string;
  phone: string;
  ticket_id: string;
  url: string;
  expires_at: string;
  reissued: boolean;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isClaimToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

/**
 * `/ticket/claim/<token>` on the web domain. The web redirect for /ticket/*
 * does not apply (next.config.ts sends /ticket/claim/* to the public claim
 * page first) and the native route registry maps the same path into the app.
 */
export function compClaimUrl(siteUrl: string, token: string): string {
  if (!isClaimToken(token)) throw new Error("Invalid claim token");
  return `${siteUrl.replace(/\/+$/, "")}/ticket/claim/${token}`;
}

export function toCompClaimLink(link: IssuedPhoneLink, recipient: string, siteUrl: string): CompClaimLink {
  return {
    recipient,
    phone: link.phone,
    ticket_id: link.ticket_id,
    url: compClaimUrl(siteUrl, link.token),
    expires_at: link.expires_at,
    reissued: link.reissued === true,
  };
}

export type ClaimCode =
  | "unauthenticated"
  | "invalid_token"
  | "expired"
  | "claimed_by_other"
  | "ticket_unavailable";

/** HTTP status and recipient-facing copy for each refusal claim_comp_ticket returns. */
export function claimRefusal(code: unknown): { status: number; code: ClaimCode; message: string } {
  switch (code) {
    case "unauthenticated":
      return { status: 401, code, message: "Sign in to claim this ticket." };
    case "expired":
      return {
        status: 410,
        code,
        message: "This link has expired. Ask the host to send you a new one.",
      };
    case "claimed_by_other":
      return {
        status: 409,
        code,
        message: "Someone else already claimed this ticket. If that wasn't you, ask the host for a new link.",
      };
    case "ticket_unavailable":
      return {
        status: 410,
        code,
        message: "This ticket was cancelled by the host.",
      };
    default:
      return {
        status: 404,
        code: "invalid_token",
        message: "This link doesn't work. It may have been replaced by a newer one from the host.",
      };
  }
}
