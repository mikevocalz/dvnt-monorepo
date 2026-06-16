/**
 * brandEmailWrapper — the ONE shell every DVNT transactional email flows through.
 *
 * Translates the landing design language into email-safe HTML: a centered 600px
 * table on near-black, a rounded "card" (the flattened glass slab), the DVNT
 * gradient wordmark image in the header with a thin gradient rule under it, and a
 * real branded footer. All structure is tables; all CSS inline. `color-scheme`
 * is pinned so dark-mode mail clients don't auto-invert the brand into mush.
 *
 * Custom display fonts are progressive enhancement only (the wordmark is an
 * image, so it renders everywhere); the @font-face below is best-effort for the
 * handful of clients that honor it (Apple Mail / some iOS).
 */

import { BRAND, COLORS, FONTS, GRADIENTS, LOGO, SPACE, esc } from "./tokens.ts";

export interface WrapperOpts {
  /** Optional preview/preheader text (shown in the inbox list, hidden in body). */
  preheader?: string;
  /** Hide the footer links row (e.g. for system codes). Footer brand line stays. */
  minimalFooter?: boolean;
}

function header(): string {
  return [
    `<tr><td align="center" style="padding:32px 32px 0">`,
    `<img src="${LOGO.wordmarkUrl}" width="${LOGO.wordmarkWidth}" height="${LOGO.wordmarkHeight}" alt="${BRAND.name}" style="display:block;border:0;outline:none;text-decoration:none;height:${LOGO.wordmarkHeight}px;width:${LOGO.wordmarkWidth}px"/>`,
    `</td></tr>`,
    // Thin gradient rule (gradient bg + solid fallback for clients that drop it).
    `<tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:3px;line-height:3px;font-size:0;border-radius:2px;background-color:${GRADIENTS.rule.solid};background-image:${GRADIENTS.rule.css}">&nbsp;</td></tr></table></td></tr>`,
  ].join("");
}

function footer(opts: WrapperOpts): string {
  const links = opts.minimalFooter
    ? ""
    : `<tr><td align="center" style="padding:4px 0 14px"><a href="${BRAND.privacyUrl}" style="color:${COLORS.textMuted};font-family:${FONTS.body};font-size:12px;text-decoration:none;padding:0 8px">Privacy</a><span style="color:${COLORS.hairline}">·</span><a href="${BRAND.faqUrl}" style="color:${COLORS.textMuted};font-family:${FONTS.body};font-size:12px;text-decoration:none;padding:0 8px">FAQ</a><span style="color:${COLORS.hairline}">·</span><a href="${BRAND.site}" style="color:${COLORS.textMuted};font-family:${FONTS.body};font-size:12px;text-decoration:none;padding:0 8px">dvntapp.live</a></td></tr>`;
  return [
    `<tr><td align="center" style="padding:24px 32px 8px">`,
    `<img src="${LOGO.glyphUrl}" width="${LOGO.glyphWidth}" height="${LOGO.glyphHeight}" alt="${BRAND.name}" style="display:block;border:0;outline:none;height:${LOGO.glyphHeight}px;width:${LOGO.glyphWidth}px;border-radius:7px;margin:0 auto 10px"/>`,
    `</td></tr>`,
    `<tr><td align="center" style="padding:0 0 4px"><p style="margin:0;font-family:${FONTS.body};font-size:12px;color:${COLORS.textFaint};text-align:center">&copy; ${BRAND.legalName} &middot; ${BRAND.society}</p></td></tr>`,
    links,
  ].join("");
}

export function brandEmailWrapper(
  content: string,
  opts: WrapperOpts = {},
): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.canvas};opacity:0">${esc(opts.preheader)}</div>`
    : "";
  return [
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">`,
    `<html xmlns="https://www.w3.org/1999/xhtml" lang="en">`,
    `<head>`,
    `<meta charset="utf-8"/>`,
    `<meta name="viewport" content="width=device-width,initial-scale=1"/>`,
    `<meta http-equiv="X-UA-Compatible" content="IE=edge"/>`,
    `<meta name="color-scheme" content="dark"/>`,
    `<meta name="supported-color-schemes" content="dark"/>`,
    `<!--[if mso]><style type="text/css">body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->`,
    `<style type="text/css">`,
    `:root{color-scheme:dark;supported-color-schemes:dark;}`,
    // Progressive-enhancement display face (best-effort; logo is the real wordmark).
    `@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:700;src:local('Space Grotesk Bold'),local('SpaceGrotesk-Bold');}`,
    `a{text-decoration:none;}`,
    `body{margin:0;padding:0;width:100%!important;background:${COLORS.canvas};}`,
    `@media only screen and (max-width:600px){.dvnt-card{width:100%!important;border-radius:0!important;}.dvnt-pad{padding-left:20px!important;padding-right:20px!important;}}`,
    `</style>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${COLORS.canvas};font-family:${FONTS.body};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">`,
    preheader,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.canvas}"><tr><td align="center" style="padding:24px 12px">`,
    // The card.
    `<table role="presentation" class="dvnt-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.panel};border:1px solid ${COLORS.hairline};border-radius:${SPACE.cardRadius}px;overflow:hidden">`,
    header(),
    // Body content.
    `<tr><td class="dvnt-pad" style="padding:28px ${SPACE.cardPadding}px 8px">${content}</td></tr>`,
    // Footer (inside the card, divided).
    `<tr><td class="dvnt-pad" style="padding:0 ${SPACE.cardPadding}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COLORS.hairline};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table></td></tr>`,
    `<tr><td class="dvnt-pad">${footer(opts)}</td></tr>`,
    `</table>`,
    `</td></tr></table>`,
    `</body></html>`,
  ].join("");
}
