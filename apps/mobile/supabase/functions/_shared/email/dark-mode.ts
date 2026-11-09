/** Gmail iOS ignores color-scheme and inverts even already-dark emails.
 * A flat gradient protects surfaces; the paired Gmail-only blends protect
 * white text on them. Never wrap images/QRs or other colored surfaces here.
 * Other clients see ordinary spans with the original inline text colors.
 * https://www.hteumeuleu.com/2021/fixing-gmail-dark-mode-css-blend-modes/
 */
export function darkSurface(color: string): string {
  return `background-color:${color};background-image:linear-gradient(${color},${color});`;
}

/** Accepts already-escaped inline HTML, just like paragraph(). */
export function protectText(html: string): string {
  return `<span class="dvnt-blend-screen" style="display:block"><span class="dvnt-blend-difference" style="display:block"><span class="dvnt-ink">${html}</span></span></span>`;
}

// Gmail replaces the doctype with <u> and the body with a classed div.
// Keep black backgrounds OUT of inline styles: clients without blend support
// must not get opaque black blocks. Gmail non-Google accounts may strip CSS;
// no sender can guarantee colors when a client removes these safeguards.
export const GMAIL_DARK_CSS =
  `u + .dvnt-body .dvnt-blend-screen{background:#000;mix-blend-mode:screen;}` +
  `u + .dvnt-body .dvnt-blend-difference{background:#000;mix-blend-mode:difference;}` +
  `u + .dvnt-body .dvnt-ink,u + .dvnt-body .dvnt-ink *{color:#fff!important;-webkit-text-fill-color:currentColor!important;}` +
  `u + .dvnt-body .dvnt-ink a{text-decoration:underline!important;}`;
