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

// Public web origin for links baked into emails (guest claim CTA, lookups).
// Mirrors the PUBLIC_SITE_URL convention used by the guest-commerce fns.
const SITE_URL = (
  (typeof Deno !== "undefined" && Deno.env.get("PUBLIC_SITE_URL")) ||
  "https://dvntapp.live"
).replace(/\/$/, "");

// ─── Calendar helpers (WS-7: add-to-calendar on ticket emails) ───────────────

/** ISO string → UTC basic format for gcal/ics (YYYYMMDDTHHMMSSZ). */
function calUtc(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function googleCalendarUrl(opts: {
  title: string;
  startIso: string;
  endIso?: string | null;
  location?: string | null;
}): string | null {
  const start = calUtc(opts.startIso);
  if (!start) return null;
  const end =
    (opts.endIso && calUtc(opts.endIso)) ||
    // gcal requires a range — default to 3 hours for open-ended events.
    calUtc(new Date(new Date(opts.startIso).getTime() + 3 * 3600_000).toISOString());
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${start}/${end}`,
  });
  if (opts.location) params.set("location", opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsDataUrl(opts: {
  title: string;
  startIso: string;
  endIso?: string | null;
  location?: string | null;
}): string | null {
  const start = calUtc(opts.startIso);
  if (!start) return null;
  const end =
    (opts.endIso && calUtc(opts.endIso)) ||
    calUtc(new Date(new Date(opts.startIso).getTime() + 3 * 3600_000).toISOString());
  const stamp = calUtc(new Date().toISOString());
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${BRAND.name}//Tickets//EN`,
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@dvntapp.live`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    ...(opts.location ? [`LOCATION:${icsEscape(opts.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
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
  /** Apple/Google Wallet save link — only for account-owned tickets today
   *  (both wallet fns require an authenticated session; guests get it after
   *  claiming). Rendered as a small link under the ticket card when set. */
  walletUrl?: string | null;
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
  summary?: { label: string; value: string; strong?: boolean }[];
  /** "Create an account" nudge for guest checkouts. */
  guestNudge?: boolean;
  toEmail?: string | null;
  /**
   * "Add to your account" magic-link claim CTA (WS-7/13). When omitted, a
   * default is derived for guest emails (guestNudge or any per-ticket
   * lookupUrl + toEmail): the /api/auth/guest-claim endpoint, which mints a
   * fresh Better Auth magic link on click — the session-create hook then
   * re-parents the guest orders. Pass null to suppress entirely.
   */
  claimUrl?: string | null;
  /**
   * Username of the restricted profile this checkout created. Swaps the
   * "Add to my account" nudge for "Finish your profile", which goes through
   * the same one-tap sign-in link.
   */
  profileUsername?: string | null;
  /** Machine-readable event time → renders Google Calendar + .ics links. */
  calendar?: { startIso: string; endIso?: string | null } | null;
  /** Overrides for non-confirmation sends (e.g. the 3-hour reminder) that
   *  reuse this layout: subject line, hero heading, preheader text. */
  subject?: string;
  heading?: string;
  preheader?: string;
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
      const wallet = t.walletUrl
        ? paragraph(
            `<a href="${esc(t.walletUrl)}" style="color:${COLORS.cyan};text-decoration:none">Add to Wallet &rarr;</a>`,
            { size: 13, align: "center", margin: "10px 0 0" },
          )
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
            wallet,
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
            wallet,
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

  // Add-to-calendar row — only when the caller supplies machine-readable
  // times (dateLine alone is a display string and can't drive gcal/ics).
  const gcalHref = opts.calendar?.startIso
    ? googleCalendarUrl({
        title: opts.eventTitle,
        startIso: opts.calendar.startIso,
        endIso: opts.calendar.endIso,
        location: opts.location,
      })
    : null;
  const icsHref = opts.calendar?.startIso
    ? icsDataUrl({
        title: opts.eventTitle,
        startIso: opts.calendar.startIso,
        endIso: opts.calendar.endIso,
        location: opts.location,
      })
    : null;
  const calendarRow =
    gcalHref || icsHref
      ? paragraph(
          [
            gcalHref
              ? `<a href="${esc(gcalHref)}" style="color:${COLORS.cyan};text-decoration:none">Add to Google Calendar</a>`
              : "",
            gcalHref && icsHref
              ? `<span style="color:${COLORS.textFaint}">&nbsp;&middot;&nbsp;</span>`
              : "",
            icsHref
              ? `<a href="${esc(icsHref)}" style="color:${COLORS.cyan};text-decoration:none">Download .ics</a>`
              : "",
          ].join(""),
          { size: 13, align: "center", margin: "12px 0 0" },
        )
      : "";

  // Guest → account claim CTA (WS-7/13). Derived for guest deliveries when
  // not explicitly provided: any per-ticket lookupUrl (guest_lookup_token is
  // guest-only) or guestNudge marks the email as guest-bound. The link mints
  // a FRESH Better Auth magic link on click (tokens expire in 15 min, so a
  // pre-minted link in a keep-forever ticket email would be dead on arrival).
  const isGuest = !!opts.guestNudge || tickets.some((t) => t.lookupUrl);
  const claimUrl =
    opts.claimUrl !== undefined
      ? opts.claimUrl
      : isGuest && opts.toEmail
        ? `${SITE_URL}/api/auth/guest-claim?email=${encodeURIComponent(opts.toEmail)}`
        : null;

  const profileNudge = claimUrl && opts.profileUsername
    ? [
        divider(),
        paragraph(
          `We made <strong style="color:${COLORS.text}">@${esc(opts.profileUsername)}</strong> for you on ${BRAND.name}, and your ${multi ? "tickets are" : "ticket is"} waiting there. Sign in with one tap to finish your profile.`,
          { size: 13, color: COLORS.textMuted },
        ),
        button(claimUrl, "Finish your profile", { gradient: "brand" }),
        paragraph(
          "Posting, comments, messages and Lynk rooms open after you verify your ID. Your tickets work at the door either way.",
          { size: 12, color: COLORS.textFaint, align: "center", margin: "4px 0 0" },
        ),
      ].join("")
    : null;

  const nudge = profileNudge
    ? profileNudge
    : claimUrl
    ? [
        divider(),
        paragraph(
          `Add ${multi ? "these tickets" : "this ticket"} to a ${BRAND.name} account with ${
            opts.toEmail ? `<strong style="color:${COLORS.text}">${esc(opts.toEmail)}</strong>` : "this email"
          } — one tap, no password. Your tickets move with you: wallet passes, transfers, and re-downloads anytime.`,
          { size: 13, color: COLORS.textMuted },
        ),
        button(claimUrl, "Add to my account", { gradient: "brand" }),
        paragraph(
          "We'll email you a secure one-time sign-in link. Nothing happens without it.",
          { size: 12, color: COLORS.textFaint, align: "center", margin: "4px 0 0" },
        ),
      ].join("")
    : opts.guestNudge
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
    subject: opts.subject ??
      (multi
        ? `Your ${tickets.length} tickets for ${opts.eventTitle}`
        : `Your ticket for ${opts.eventTitle}`),
    html: brandEmailWrapper(
      [
        heading(opts.heading ?? "You're in 🎟️"),
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
        preheader: opts.preheader ??
          `${multi ? `${tickets.length} tickets` : "Your ticket"} for ${opts.eventTitle}`,
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

export interface WelcomeOpts {
  /**
   * The profile was made for the member at guest checkout and stays locked
   * until they verify their ID. Adds the paragraph that says how to unlock it.
   */
  checkoutProfile?: boolean;
}

/**
 * The welcome copy, verbatim from the DVNT team. Do not reword, trim or
 * re-punctuate it here: a test in ../brand-outbox.test.cjs pins every line,
 * in order. "greeting" is the opening line, "heading" lines are the all-caps
 * section titles, everything else is a body paragraph.
 */
export const WELCOME_COPY: ReadonlyArray<{
  kind: "greeting" | "heading" | "p";
  text: string;
}> = [
  { kind: "greeting", text: "Welcome to DVNT," },
  { kind: "p", text: "The “Cookout” for Black, Brown & Queer community." },
  { kind: "p", text: "Pull up a chair. You belong here." },
  { kind: "p", text: "DVNT is a digital community built with Black and Brown Queer people at its center. It’s also open to invited-allies who respect, support, and celebrate us fully." },
  { kind: "heading", text: "REAL PEOPLE. REAL COMMUNITY." },
  { kind: "p", text: "DVNT is for real ones. To fully participate in the platform, members must VERIFY their identity and confirm they meet the applicable age requirement for adult access (18+ in the United States)." },
  { kind: "p", text: "We do this to help create a safer, more accountable community where people can connect with confidence." },
  { kind: "heading", text: "ONLINE AND IRL" },
  { kind: "p", text: "DVNT is intentionally sexy, sophisticated, and accessible from your phone or computer—designed to keep our community connected both online and in real life." },
  { kind: "p", text: "Express yourself. Share what’s on your mind. Discover what’s happening around you. Or create something of your own." },
  { kind: "p", text: "Hosting a kickback? Party? Professional Mixer? Picnic? Game night? Group Fitness? First Date? Movie Night?" },
  { kind: "p", text: "Put it on DVNT." },
  { kind: "p", text: "DVNT is also an economic empowerment platform for our community’s curators, hosts, content creators, and entrepreneurs. We want more of our community’s attention, opportunities, and dollars circulating among the people creating our culture." },
  { kind: "heading", text: "OUR CULTURE. OUR EXPRESSION. OUR SPACE." },
  { kind: "p", text: "Our bodies, expression, culture, conversations, and events deserve space to exist without being unnecessarily censored or shamed." },
  { kind: "p", text: "DVNT was built to protect that freedom of expression —not police it." },
  { kind: "p", text: "And freedom here comes with responsibility for how we treat one another. Social responsibility." },
  { kind: "heading", text: "NO HATE. NO HARASSMENT. NO EXCEPTIONS." },
  { kind: "p", text: "There is no place on DVNT for transphobia, homophobia, biphobia, racism, anti-Blackness, xenophobia, sexism, ableism, harassment, or discrimination of any kind." },
  { kind: "p", text: "Members who violate our Community Standards may lose access to DVNT, including permanent removal from the platform and restrictions against creating replacement accounts." },
  { kind: "heading", text: "THE RULES ARE SIMPLE." },
  { kind: "p", text: "Be bold. Be sexy. Be yourself." },
  { kind: "p", text: "Mind the business that pays you." },
  { kind: "p", text: "Be kind. Be considerate. Respect boundaries and get consent." },
  { kind: "p", text: "Don’t body-shame. Don’t slut-shame. Don’t harass people because they aren’t interested in you or interesting to you." },
  { kind: "p", text: "Leave the prejudice, judgment, and unnecessary hangups at home. Here is where we come to connect and do so safely, with real people, among real community." },
  { kind: "p", text: "Welcome to DVNT." },
];

/**
 * Section title inside the welcome email. Same face, colour and weight as
 * heading(), sized down and emitted as h2 so the email keeps a single h1.
 */
function sectionHeading(text: string): string {
  return `<h2 style="margin:32px 0 12px;font-family:${FONTS.display};font-size:17px;line-height:1.3;font-weight:700;letter-spacing:0.04em;color:${COLORS.text};text-align:left">${esc(text)}</h2>`;
}

/**
 * `name` stays in the signature for the three callers (auth user.create hook,
 * brand-outbox-worker, send-email) but is not rendered: the copy opens with
 * "Welcome to DVNT," and adding a name line would add words the team did not
 * write.
 */
export function welcome(_name?: string | null, opts: WelcomeOpts = {}): EmailContent {
  const unlock = opts.checkoutProfile
    ? card(
        paragraph(
          "We made this profile when you got your ticket. Posting, comments, messages and Lynk rooms open after you verify your ID: sign in with this email address, then tap <strong>Verify your ID</strong> at the top of your feed. Your tickets work at the door either way.",
          { size: 15, color: COLORS.textBody, margin: "0" },
        ),
      )
    : "";
  const body = WELCOME_COPY.map(({ kind, text }) =>
    kind === "greeting"
      ? heading(esc(text))
      : kind === "heading"
        ? sectionHeading(text)
        : paragraph(esc(text)),
  );
  return {
    subject: `Welcome to the cookout — ${BRAND.name}`,
    html: brandEmailWrapper(
      [
        ...body,
        unlock ? `<div style="height:8px"></div>${unlock}` : "",
        `<div style="height:8px"></div>`,
        // MUST be an https universal link, never the bare `dvnt://` scheme.
        //
        // `dvnt://` only resolves on a device with the app installed. For
        // anyone who signed up in a browser it is a dead button, and mail
        // clients — Gmail in particular, which rewrites every href through its
        // own redirector — routinely strip or refuse non-http(s) schemes, so
        // it could fail even on a phone that has the app. That combination is
        // what broke the welcome CTA for real signups.
        //
        // SITE_URL is registered for App Links / Universal Links on both
        // platforms (app.config.js: `applinks:dvntapp.live` on iOS,
        // intentFilters with autoVerify on Android), so https gives us the
        // behaviour the deep link was reaching for AND a real fallback:
        // app if installed, website if not, and it survives Gmail.
        //
        // /feed specifically, not the root: the AASA deliberately leaves `/`
        // and `/auth/*` to the web (apps/web/.well-known/apple-app-site-
        // association), so a root link would never open the app on iOS. /feed
        // is claimed by both platforms AND renders on the web for anyone
        // without the app installed.
        button(`${SITE_URL}/feed`, `Open ${BRAND.name}`, { gradient: "brand" }),
      ].join(""),
      { preheader: WELCOME_COPY[1].text },
    ),
  };
}

/**
 * promoterInvite — sent when a host adds a DVNT member as an event promoter
 * (T07). Same destination as the push: the promoter dashboard, where payout
 * setup is the first thing a new promoter does. The code sits in a plain card
 * rather than codeBlock, whose 40px tracked type only fits short numeric codes.
 */
export function promoterInvite(opts: {
  eventId: number;
  eventTitle?: string | null;
  hostHandle?: string | null;
  code: string;
}): EmailContent {
  const event = opts.eventTitle?.trim() || "an event";
  const host = opts.hostHandle?.trim() || "An event host";
  const url = `${SITE_URL}/feed/events/${opts.eventId}/promoter`;
  return {
    subject: `You're a promoter for ${event}`,
    html: brandEmailWrapper(
      [
        heading("You're a promoter"),
        paragraph(`${esc(host)} added you as a promoter for <strong style="color:${COLORS.text}">${esc(event)}</strong>.`),
        card(
          paragraph(
            `Your code: <strong style="font-family:${FONTS.mono};color:${COLORS.cyan}">${esc(opts.code)}</strong>`,
            { size: 18, color: COLORS.text, margin: "0" },
          ),
        ),
        paragraph("Share it with your people. Set up payouts on your promoter dashboard so your earnings can reach you.", {
          size: 15,
        }),
        button(url, "Open promoter dashboard", { gradient: "brand" }),
      ].join(""),
      { preheader: `Your promoter code for ${event}` },
    ),
  };
}

/**
 * magicLinkEmail — one-tap sign-in link (B4). Also powers the guided finish
 * flow for stalled accounts: the link resumes exactly where they left off.
 */
export function magicLinkEmail(url: string): EmailContent {
  return {
    subject: `Your ${BRAND.name} sign-in link`,
    html: brandEmailWrapper(
      [
        heading("Pick up where you left off"),
        paragraph(
          "Tap the button and you're in — no password needed. The link works once and expires in 15 minutes.",
        ),
        button(url, `Open ${BRAND.name}`, { gradient: "brand" }),
        divider(),
        paragraph(
          "Didn't ask for this? You can safely ignore it — nothing happens without the link.",
          { size: 13, color: COLORS.textMuted, margin: "0" },
        ),
      ].join(""),
      { preheader: `One tap to get back into ${BRAND.name}`, minimalFooter: true },
    ),
  };
}

/**
 * accountLinked — sent when a social sign-in (Google/Apple) is merged into an
 * EXISTING account by matching email. Reassures + gives a security escape hatch.
 */
export function accountLinked(
  name: string | null | undefined,
  opts: { provider?: string; email?: string | null } = {},
): EmailContent {
  const who = name ? esc(name) : "there";
  const provider = esc(opts.provider || "Google");
  const emailLine = opts.email
    ? ` (<strong style="color:${COLORS.text}">${esc(opts.email)}</strong>)`
    : "";
  return {
    subject: `Your ${provider} account is now linked to ${BRAND.name}`,
    html: brandEmailWrapper(
      [
        heading("One account, two ways in"),
        paragraph(`Hey ${who},`),
        paragraph(
          `You signed in with ${provider}, and it matched the email on your existing ${BRAND.name} account${emailLine}. We've merged them — same profile, same events, same crew.`,
        ),
        card(
          paragraph(
            [
              "• Nothing about your profile or data changed<br/>",
              `• Sign in with ${provider} or your password — both open the same account<br/>`,
              "• Your saved events, messages, and follows are right where you left them",
            ].join(""),
            { size: 15, color: COLORS.textBody, margin: "0" },
          ),
        ),
        divider(),
        paragraph(
          `Wasn't you? <a href="https://dvntapp.live/auth/forgot-password" style="color:${COLORS.text};font-weight:600">Reset your password</a> right away — that locks the account back down.`,
          { size: 13, color: COLORS.textMuted, margin: "0" },
        ),
      ].join(""),
      { preheader: `Your ${provider} sign-in now opens your ${BRAND.name} account` },
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
