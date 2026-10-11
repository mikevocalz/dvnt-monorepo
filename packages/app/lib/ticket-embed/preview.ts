/** No scripts, forms, checkout callbacks or access to the parent page. */
export function escapeEmbedHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function safeFlyerUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Video and unsupported image sources need the media resolver, never an img.
    if (/\.(?:mov|mp4|webm|heic|heif)$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function renderOrganizerEmbedPreview(event: {
  title: string; startDate: string | null; timeZone?: string | null; location: string; flyerUrl: string | null;
}, logoSvg: string): string {
  // SVG stays an SVG image, preserving its artwork and transparent background.
  const logo = 'data:image/svg+xml,' + encodeURIComponent(logoSvg);
  const flyer = safeFlyerUrl(event.flyerUrl);
  const esc = escapeEmbedHtml;
  let time = 'Event time to be announced';
  if (event.startDate && Number.isFinite(Date.parse(event.startDate))) {
    try {
      time = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: event.timeZone || 'UTC' }).format(new Date(event.startDate));
    } catch { time = new Date(event.startDate).toISOString() + ' (UTC)'; }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;color:#fff;background:transparent}*{box-sizing:border-box}body{margin:0}.widget{max-width:1100px;margin:auto;background:#09090c;border:1px solid #ffffff1a;border-radius:16px;overflow:hidden}header,footer{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;gap:12px}header{border-bottom:1px solid #ffffff1a}header img{width:112px;height:auto}header small{color:#aaa;font-size:10px;letter-spacing:1px}main{display:grid;grid-template-columns:minmax(0,1fr)}section{min-width:0}.flyer{display:block;width:100%;max-height:440px;object-fit:contain;background:#06070d}.missing{padding:64px 24px;text-align:center;color:#888;background:#101015}.info,.checkout{padding:20px}h1{font-size:22px;margin:0 0 8px;overflow-wrap:anywhere}h2{font-size:18px;margin:0 0 16px}p{font-size:13px;line-height:1.6;color:#aaa;margin:6px 0;overflow-wrap:anywhere}.ticket{border:1px solid #379ed8;border-radius:12px;background:#379ed80d;padding:18px;margin:12px 0;font-size:14px}.steps{color:#3fdcff;font-size:12px;margin-bottom:22px}.button{padding:15px;border-radius:12px;background:linear-gradient(90deg,#379ed8,#874e9f);color:white;text-align:center;font-weight:bold;margin-top:20px;opacity:.6}.notice{margin-top:16px;font-size:12px}footer{justify-content:center;border-top:1px solid #ffffff1a;padding-bottom:20px}footer span{font-size:12px;color:#aaa;position:relative;top:12px}footer img{width:78px;height:30px;object-fit:contain}@media(min-width:740px){main{grid-template-columns:minmax(0,.88fr) minmax(0,1fr)}.event{border-right:1px solid #ffffff1a}.checkout{padding:28px}.flyer{max-height:540px}}@media(max-width:350px){header,.info,.checkout{padding:16px}header img{width:90px}header small{font-size:9px}}</style></head><body>
<div class="widget"><header><img src="${logo}" alt="DVNT"><small>ORGANIZER PREVIEW</small></header><main><section class="event">
${flyer ? `<img class="flyer" src="${esc(flyer)}" alt="${esc(event.title)} event flyer" referrerpolicy="no-referrer">` : '<div class="missing">No previewable event flyer</div>'}
<div class="info"><h1>${esc(event.title)}</h1><p>${esc(time)}</p><p>${esc(event.location)}</p></div></section><section class="checkout"><p class="steps">Tickets → Checkout → Confirmation</p><h2>Tickets</h2><div class="ticket">Your event’s available ticket tiers will appear here.</div><p>No sample prices are presented as live prices.</p><div class="button" role="button" aria-disabled="true">Checkout not enabled</div><p class="notice">Layout preview only. No ticket holds, payments, accounts or emails are created. Existing DVNT ticket purchases are unchanged.</p></section></main><footer><span>Powered by</span><img src="${logo}" alt="DVNT"></footer></div></body></html>`;
}
