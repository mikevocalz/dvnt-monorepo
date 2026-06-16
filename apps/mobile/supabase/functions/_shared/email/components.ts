/**
 * Email component kit — composable, plain-TS string builders. No React (these
 * run in Deno edge). Every piece is table/inline-CSS only so it renders across
 * Apple Mail, Gmail, and Outlook. Compose templates from these so every DVNT
 * email speaks one visual language.
 */

import { COLORS, FONTS, GRADIENTS, LOGO, SPACE, esc, tierTheme } from "./tokens.ts";

/** H1 — white display heading on dark. `gradient` opt applies a clip-on-text
 *  trick where supported, always with a solid white fallback. */
export function heading(
  text: string,
  opts: { size?: number; gradient?: boolean; align?: string } = {},
): string {
  const size = opts.size ?? 26;
  const align = opts.align ?? "left";
  const grad = opts.gradient
    ? `background-image:${GRADIENTS.brand.css};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;`
    : "";
  return `<h1 style="margin:0 0 12px;font-family:${FONTS.display};font-size:${size}px;line-height:1.2;font-weight:700;color:${COLORS.text};text-align:${align};${grad}">${text}</h1>`;
}

/** Body paragraph. */
export function paragraph(
  html: string,
  opts: { color?: string; size?: number; align?: string; margin?: string } = {},
): string {
  const color = opts.color ?? COLORS.textBody;
  const size = opts.size ?? 16;
  const align = opts.align ?? "left";
  const margin = opts.margin ?? "0 0 16px";
  return `<p style="margin:${margin};font-family:${FONTS.body};font-size:${size}px;line-height:1.6;color:${color};text-align:${align}">${html}</p>`;
}

/** Hairline divider. */
export function divider(margin = "28px 0"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COLORS.hairline};font-size:0;line-height:0;height:1px;margin:${margin}">&nbsp;</td></tr></table><div style="height:0;margin:${margin.split(" ")[0]} 0"></div>`;
}

/** Nested inset card (used to group related rows / a code / a ticket). */
export function card(inner: string, opts: { accent?: string } = {}): string {
  const accentBar = opts.accent
    ? `border-top:3px solid ${opts.accent};`
    : `border:1px solid ${COLORS.hairline};`;
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">`,
    `<tr><td style="background:${COLORS.panelInset};border-radius:${SPACE.panelRadius}px;${accentBar}padding:20px">`,
    inner,
    `</td></tr></table>`,
  ].join("");
}

/**
 * Bulletproof gradient CTA. VML fills it for Outlook (which ignores
 * background-image), the anchor carries the gradient + a solid fallback for
 * everyone else.
 */
export function button(
  href: string,
  label: string,
  opts: { gradient?: keyof typeof GRADIENTS; width?: number } = {},
): string {
  const g = GRADIENTS[opts.gradient ?? "brand"] as {
    css: string;
    solid: string;
    vmlFrom?: string;
    vmlTo?: string;
  };
  const w = opts.width ?? 280;
  const safeHref = esc(href);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px"><tr><td align="center">`,
    `<!--[if mso]>`,
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:50px;v-text-anchor:middle;width:${w}px;" arcsize="24%" fillcolor="${g.solid}" stroke="f">`,
    `<v:fill type="gradient" color="${g.vmlFrom ?? g.solid}" color2="${g.vmlTo ?? g.solid}" angle="135"/>`,
    `<center style="color:#ffffff;font-family:${FONTS.body};font-size:16px;font-weight:700;">${label}</center>`,
    `</v:roundrect>`,
    `<![endif]-->`,
    `<!--[if !mso]><!-->`,
    `<a href="${safeHref}" style="display:inline-block;min-width:${w}px;background-color:${g.solid};background-image:${g.css};color:#ffffff;text-decoration:none;font-family:${FONTS.body};font-size:16px;font-weight:700;line-height:50px;text-align:center;border-radius:12px;">${label}</a>`,
    `<!--<![endif]-->`,
    `</td></tr></table>`,
  ].join("");
}

/** Big, tracked, copy-friendly verification code on a bordered panel. */
export function codeBlock(code: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px"><tr>`,
    `<td align="center" style="background:${COLORS.panelInset};border:1px solid ${COLORS.hairline};border-radius:${SPACE.panelRadius}px;padding:24px 16px">`,
    `<div style="font-family:${FONTS.mono};font-size:40px;font-weight:800;letter-spacing:12px;color:${COLORS.cyan};line-height:1;padding-left:12px">${esc(code)}</div>`,
    `</td></tr></table>`,
  ].join("");
}

/** Label/value row for order summaries & statements. */
export function infoRow(
  label: string,
  value: string,
  opts: { strong?: boolean; accent?: string } = {},
): string {
  const valColor = opts.accent ?? (opts.strong ? COLORS.text : COLORS.textBody);
  const weight = opts.strong ? "700" : "400";
  const size = opts.strong ? 16 : 14;
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px"><tr>`,
    `<td style="font-family:${FONTS.body};font-size:${size}px;color:${COLORS.textMuted};text-align:left">${label}</td>`,
    `<td style="font-family:${FONTS.body};font-size:${size}px;font-weight:${weight};color:${valColor};text-align:right">${value}</td>`,
    `</tr></table>`,
  ].join("");
}

/** Tier badge pill — gradient fill per tierTheme (with solid fallback). */
export function tierBadge(tier?: string | null, labelOverride?: string): string {
  const t = tierTheme(tier);
  const label = esc(labelOverride ?? t.label);
  return `<span style="display:inline-block;background-color:${t.accent};background-image:${t.grad};color:#ffffff;font-family:${FONTS.body};font-size:11px;font-weight:800;letter-spacing:1.5px;padding:5px 12px;border-radius:999px;text-transform:uppercase">${label}</span>`;
}

/**
 * Event header block — optional flyer with a dominant_color accent bar, event
 * title, and date/location line. Image degrades gracefully (alt + no broken box
 * when omitted).
 */
export function eventHeader(opts: {
  title: string;
  flyerUrl?: string | null;
  dominantColor?: string | null;
  dateLine?: string | null;
  location?: string | null;
}): string {
  const accent = opts.dominantColor || COLORS.teal;
  const flyer = opts.flyerUrl
    ? `<tr><td style="padding:0 0 16px"><img src="${esc(opts.flyerUrl)}" alt="${esc(opts.title)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border-radius:${SPACE.panelRadius}px;border:1px solid ${COLORS.hairline}"/></td></tr>`
    : "";
  const date = opts.dateLine
    ? `<p style="margin:6px 0 0;font-family:${FONTS.body};font-size:14px;color:${COLORS.textBody}">${esc(opts.dateLine)}</p>`
    : "";
  const loc = opts.location
    ? `<p style="margin:2px 0 0;font-family:${FONTS.body};font-size:14px;color:${COLORS.textBody}">${esc(opts.location)}</p>`
    : "";
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    flyer,
    `<tr><td style="border-left:3px solid ${accent};padding:2px 0 2px 14px">`,
    `<p style="margin:0;font-family:${FONTS.display};font-size:20px;font-weight:700;color:${COLORS.text};line-height:1.25">${esc(opts.title)}</p>`,
    date,
    loc,
    `</td></tr></table>`,
  ].join("");
}

/** QR block — image + selectable token text + optional "view ticket" link. */
export function qrBlock(opts: {
  qrToken: string;
  index?: number;
  total?: number;
  lookupUrl?: string | null;
}): string {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(opts.qrToken)}`;
  const counter =
    opts.index != null && opts.total != null && opts.total > 1
      ? `<p style="margin:0 0 10px;font-family:${FONTS.body};font-size:13px;color:${COLORS.textMuted};text-align:center">Ticket ${opts.index + 1} of ${opts.total}</p>`
      : "";
  const link = opts.lookupUrl
    ? `<p style="text-align:center;margin:14px 0 0"><a href="${esc(opts.lookupUrl)}" style="color:${COLORS.cyan};font-family:${FONTS.body};font-size:13px;text-decoration:none">View ticket &rarr;</a></p>`
    : "";
  return [
    counter,
    `<img src="${qrSrc}" alt="QR code" width="200" height="200" style="display:block;margin:0 auto;width:200px;height:200px;background:#ffffff;border-radius:10px;padding:8px"/>`,
    `<p style="margin:12px 0 0;font-family:${FONTS.mono};font-size:11px;color:${COLORS.textBody};text-align:center;word-break:break-all">${esc(opts.qrToken)}</p>`,
    link,
  ].join("");
}
