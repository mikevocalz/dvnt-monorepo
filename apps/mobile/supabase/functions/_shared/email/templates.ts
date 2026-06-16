/**
 * Email templates — compose the component kit into the actual transactional
 * emails DVNT sends. Each returns `{ subject, html }` with the html already
 * wrapped in the brand shell, so call sites just
 * `sendResendEmail({ to, ...verificationCode(code) })`.
 *
 * Templates only style; they never change WHAT triggers an email or reword
 * content semantics (mirrors the watch's content restraint).
 */

import { BRAND, COLORS, FONTS, esc, tierTheme } from "./tokens.ts";
import {
  button,
  card,
  codeBlock,
  divider,
  eventHeader,
  heading,
  infoRow,
  paragraph,
  qrBlock,
  tierBadge,
} from "./components.ts";
import { brandEmailWrapper } from "./wrapper.ts";

export interface EmailContent {
  subject: string;
  html: string;
}

// ─── verificationCode — the most-sent email, make it the most polished ───────

export function verificationCode(
  code: string,
  opts: { expiryMin?: number; title?: string; intro?: string } = {},
): EmailContent {
  const expiry = opts.expiryMin ?? 10;
  const title = opts.title ?? "Confirm your RSVP";
  const intro =
    opts.intro ??
    `Enter this code to confirm. It expires in ${expiry} minutes.`;
  return {
    subject: `${code} is your ${BRAND.name} code`,
    html: brandEmailWrapper(
      [
        heading(title),
        paragraph(esc(intro)),
        codeBlock(code),
        paragraph(
          `This code expires in <strong style="color:${COLORS.text}">${expiry} minutes</strong>. For your security, don't share it with anyone.`,
          { size: 14, color: COLORS.textMuted },
        ),
        divider(),
        paragraph(
          "Didn't request this? You can safely ignore this email — no action is needed.",
          { size: 13, color: COLORS.textFaint, margin: "0" },
        ),
      ].join(""),
      { preheader: `${code} — your ${BRAND.name} verification code`, minimalFooter: true },
    ),
  };
}

// ─── ticketConfirmation — handles multiple tickets, tier badges, QR ──────────

export interface TicketLine {
  tier?: string | null;
  tierLabel?: string | null;
  qrToken?: string | null;
  lookupUrl?: string | null;
  /** Optional per-ticket holder/seat note. */
  note?: string | null;
}

export interface TicketConfirmationOpts {
  eventTitle: string;
  tickets: TicketLine[];
  flyerUrl?: string | null;
  dominantColor?: string | null;
  dateLine?: string | null;
  location?: string | null;
  greeting?: string | null;
  /** App/wallet CTA when there's no per-ticket QR (e.g. account holders). */
  manageUrl?: string | null;
  /** Order total summary lines, label→value. */
  summary?: Array<{ label: string; value: string; strong?: boolean }>;
  /** "Create an account" nudge for guest checkouts. */
  guestNudge?: boolean;
  toEmail?: string | null;
}

export function ticketConfirmation(opts: TicketConfirmationOpts): EmailContent {
  const tickets = opts.tickets ?? [];
  const multi = tickets.length > 1;

  const ticketCards = tickets
    .map((t, i) => {
      const theme = tierTheme(t.tier);
      const badge = tierBadge(t.tier, t.tierLabel ?? undefined);
      const note = t.note
        ? paragraph(esc(t.note), {
            size: 13,
            color: COLORS.textMuted,
            margin: "8px 0 0",
            align: "center",
          })
        : "";
      const body = t.qrToken
        ? [
            `<div style="text-align:center;margin:0 0 12px">${badge}</div>`,
            qrBlock({
              qrToken: t.qrToken,
              index: i,
              total: tickets.length,
              lookupUrl: t.lookupUrl,
            }),
            note,
          ].join("")
        : [
            `<div style="text-align:center;margin:0 0 12px">${badge}</div>`,
            paragraph(
              multi ? `Ticket ${i + 1} of ${tickets.length}` : "Your ticket",
              { size: 13, color: COLORS.textMuted, align: "center", margin: "0" },
            ),
            note,
            t.lookupUrl
              ? paragraph(
                  `<a href="${esc(t.lookupUrl)}" style="color:${COLORS.cyan};text-decoration:none">Tap to view your QR &rarr;</a>`,
                  { size: 13, align: "center", margin: "10px 0 0" },
                )
              : "",
          ].join("");
      return card(body, { accent: theme.accent });
    })
    .join("");

  const summary =
    opts.summary && opts.summary.length
      ? card(
          opts.summary
            .map((s) => infoRow(esc(s.label), esc(s.value), { strong: s.strong }))
            .join(""),
        )
      : "";

  const manage =
    opts.manageUrl && !tickets.some((t) => t.qrToken)
      ? button(opts.manageUrl, "View in app", { gradient: "brand" })
      : opts.manageUrl
        ? paragraph(
            `<a href="${esc(opts.manageUrl)}" style="color:${COLORS.cyan};text-decoration:none">Manage your tickets &rarr;</a>`,
            { size: 14, align: "center", margin: "8px 0 0" },
          )
        : "";

  const nudge = opts.guestNudge
    ? [
        divider(),
        paragraph(
          `Create a ${BRAND.name} account with ${
            opts.toEmail ? `<strong style="color:${COLORS.text}">${esc(opts.toEmail)}</strong>` : "this email"
          } to manage your RSVPs and tickets anytime.`,
          { size: 13, color: COLORS.textMuted, margin: "0" },
        ),
      ].join("")
    : "";

  return {
    subject: multi
      ? `Your ${tickets.length} tickets for ${opts.eventTitle}`
      : `Your ticket for ${opts.eventTitle}`,
    html: brandEmailWrapper(
      [
        heading("You're in 🎟️"),
        opts.greeting
          ? paragraph(esc(opts.greeting), { size: 15 })
          : paragraph(
              `Your ${multi ? "tickets are" : "ticket is"} confirmed. ${
                tickets.some((t) => t.qrToken)
                  ? `Show the QR ${multi ? "codes" : "code"} below at the door — each ticket has its own.`
                  : "Open the app to access your tickets."
              }`,
            ),
        divider("20px 0"),
        eventHeader({
          title: opts.eventTitle,
          flyerUrl: opts.flyerUrl,
          dominantColor: opts.dominantColor,
          dateLine: opts.dateLine,
          location: opts.location,
        }),
        `<div style="height:20px"></div>`,
        ticketCards,
        manage,
        summary,
        nudge,
      ].join(""),
      {
        preheader: `${multi ? `${tickets.length} tickets` : "Your ticket"} for ${opts.eventTitle}`,
      },
    ),
  };
}

// ─── broadcast — host message to attendees (style only, never reword) ────────

export function broadcast(opts: {
  eventTitle: string;
  message: string;
  hostName?: string | null;
  flyerUrl?: string | null;
  dominantColor?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
}): EmailContent {
  const attribution = opts.hostName
    ? paragraph(`From <strong style="color:${COLORS.text}">${esc(opts.hostName)}</strong>`, {
        size: 13,
        color: COLORS.textMuted,
        margin: "0 0 8px",
      })
    : "";
  // Preserve message line breaks without rewording.
  const messageHtml = esc(opts.message).replace(/\n/g, "<br/>");
  return {
    subject: `${opts.eventTitle}: a message from the host`,
    html: brandEmailWrapper(
      [
        eventHeader({
          title: opts.eventTitle,
          flyerUrl: opts.flyerUrl,
          dominantColor: opts.dominantColor,
        }),
        `<div style="height:20px"></div>`,
        attribution,
        card(
          paragraph(messageHtml, { size: 16, color: COLORS.text, margin: "0" }),
        ),
        opts.ctaUrl
          ? button(opts.ctaUrl, opts.ctaLabel ?? "Open in app", { gradient: "brand" })
          : "",
      ].join(""),
      { preheader: `A message about ${opts.eventTitle}` },
    ),
  };
}

// ─── payoutStatement — host payout (replaces raw inline HTML) ─────────────────

export function payoutStatement(opts: {
  eventTitle: string;
  ticketsSold: number;
  ticketsRefunded: number;
  grossCents: number;
  refundsCents: number;
  feeCents: number;
  netCents: number;
  releaseDate?: string | null;
}): EmailContent {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  return {
    subject: `Payout statement — ${opts.eventTitle}`,
    html: brandEmailWrapper(
      [
        heading("Payout statement"),
        paragraph(
          `Funds for <strong style="color:${COLORS.text}">${esc(opts.eventTitle)}</strong> have been transferred to your connected bank account.`,
        ),
        card(
          [
            infoRow("Tickets sold", String(opts.ticketsSold)),
            infoRow("Tickets refunded", String(opts.ticketsRefunded)),
          ].join(""),
        ),
        card(
          [
            infoRow("Gross revenue", usd(opts.grossCents)),
            infoRow("Refunds", `-${usd(opts.refundsCents)}`),
            infoRow("DVNT platform fee", `-${usd(opts.feeCents)}`),
            `<div style="border-top:1px solid ${COLORS.hairline};margin:10px 0 8px;height:1px;font-size:0">&nbsp;</div>`,
            infoRow("Net payout", usd(opts.netCents), { strong: true, accent: COLORS.cyan }),
          ].join(""),
        ),
        opts.releaseDate
          ? paragraph(`Release date: ${esc(opts.releaseDate)}`, {
              size: 13,
              color: COLORS.textMuted,
              margin: "0",
            })
          : "",
      ].join(""),
      { preheader: `Payout statement for ${opts.eventTitle}` },
    ),
  };
}

// ─── Better Auth: welcome / reset / verify (link-based) ──────────────────────

export function welcome(name?: string | null): EmailContent {
  const who = name ? esc(name) : "there";
  return {
    subject: `Welcome to ${BRAND.name}!`,
    html: brandEmailWrapper(
      [
        heading(`Welcome to ${BRAND.name} 🎉`),
        paragraph(`Hey ${who},`),
        paragraph(
          "Your account is live. You're now part of the community where nightlife meets culture.",
        ),
        card(
          paragraph(
            [
              "• Discover events happening near you<br/>",
              "• Share stories and connect with your crew<br/>",
              "• Get exclusive access to VIP experiences",
            ].join(""),
            { size: 15, color: COLORS.textBody, margin: "0" },
          ),
        ),
        button("dvnt://", `Open ${BRAND.name}`, { gradient: "brand" }),
      ].join(""),
      { preheader: `Welcome to ${BRAND.name} — your account is live` },
    ),
  };
}

export function resetPassword(url: string): EmailContent {
  return {
    subject: `Reset your ${BRAND.name} password`,
    html: brandEmailWrapper(
      [
        heading("Reset Your Password"),
        paragraph(
          "We received a request to reset your password. Tap the button below to choose a new one. This link expires in 1 hour.",
        ),
        button(url, "Reset Password", { gradient: "brand" }),
        paragraph(
          "If you didn't request this, you can safely ignore this email.",
          { size: 13, color: COLORS.textMuted },
        ),
        paragraph(
          `Or copy this link:<br/><span style="color:${COLORS.textFaint};word-break:break-all">${esc(url)}</span>`,
          { size: 12, color: COLORS.textFaint, margin: "0" },
        ),
      ].join(""),
      { preheader: `Reset your ${BRAND.name} password` },
    ),
  };
}

export function verifyEmailLink(url: string, name?: string | null): EmailContent {
  const who = name ? esc(name) : "there";
  return {
    subject: `Confirm your ${BRAND.name} email`,
    html: brandEmailWrapper(
      [
        heading("Confirm Your Email"),
        paragraph(`Hey ${who},`),
        paragraph(
          "Tap the button below to verify your email address. This link expires in 24 hours.",
        ),
        button(url, "Confirm Email", { gradient: "brand" }),
        paragraph(
          "If you didn't create an account, you can safely ignore this email.",
          { size: 13, color: COLORS.textMuted },
        ),
        paragraph(
          `Or copy this link:<br/><span style="color:${COLORS.textFaint};word-break:break-all">${esc(url)}</span>`,
          { size: 12, color: COLORS.textFaint, margin: "0" },
        ),
      ].join(""),
      { preheader: `Confirm your ${BRAND.name} email address` },
    ),
  };
}

/** Alias matching the Prompt 11B template name. Same template — link-based
 *  verify (Better Auth emits a verification *link*, not a code). */
export const verifyEmail = verifyEmailLink;
