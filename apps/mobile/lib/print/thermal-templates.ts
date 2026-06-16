/**
 * Thermal Receipt Printer Templates
 *
 * HTML templates designed for 58mm and 80mm thermal receipt printers.
 * Rules:
 * - Narrow width (58mm ≈ 384px, 80mm ≈ 576px)
 * - High contrast monochrome
 * - Large legible font, no tiny text
 * - QR code centered with quiet zone
 * - No heavy images; logo optional + monochrome-friendly
 * - Safe margins and line wrapping
 * - Separation lines where helpful
 */

import type { Order, OrganizerBranding } from "@/lib/types/payments";

const DVNT_LOGO_TEXT = "DVNT";

interface ReceiptData {
  order: Order;
  branding?: OrganizerBranding | null;
  qrDataUrl?: string;
  dvntLogoUrl?: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Shared Styles ────────────────────────────────────────────

function baseStyles(widthPx: number): string {
  return `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Courier New', monospace;
        width: ${widthPx}px;
        max-width: ${widthPx}px;
        background: #fff;
        color: #000;
        padding: 12px;
        font-size: 13px;
        line-height: 1.4;
      }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .divider {
        border-top: 1px dashed #000;
        margin: 8px 0;
      }
      .thick-divider {
        border-top: 2px solid #000;
        margin: 10px 0;
      }
      .row {
        display: flex;
        justify-content: space-between;
        margin: 2px 0;
      }
      .row-label { flex: 1; }
      .row-value { text-align: right; font-weight: bold; }
      .qr-container {
        text-align: center;
        margin: 12px 0;
        padding: 8px;
      }
      .qr-container img {
        width: ${Math.min(widthPx - 48, 200)}px;
        height: ${Math.min(widthPx - 48, 200)}px;
        image-rendering: pixelated;
      }
      .logo-container {
        text-align: center;
        margin-bottom: 8px;
      }
      .logo-container img {
        max-width: ${Math.round(widthPx * 0.5)}px;
        max-height: 48px;
        filter: grayscale(100%);
      }
      .logo-text {
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 2px;
      }
      .cut-line {
        text-align: center;
        margin: 12px 0 4px;
        font-size: 10px;
        color: #999;
      }
      .cut-line::before,
      .cut-line::after {
        content: '✂ - - - - - - - - - - - - - -';
        font-size: 10px;
        color: #999;
      }
      .footer {
        text-align: center;
        font-size: 10px;
        color: #666;
        margin-top: 8px;
      }
      .ticket-id {
        font-size: 10px;
        color: #666;
        text-align: center;
        margin-top: 4px;
      }
      h1 { font-size: 16px; margin: 4px 0; }
      h2 { font-size: 14px; margin: 4px 0; }
      .total-row {
        display: flex;
        justify-content: space-between;
        font-size: 16px;
        font-weight: bold;
        margin: 6px 0;
      }
    </style>
  `;
}

// ─── Receipt Template (58mm) ──────────────────────────────────

export function receiptThermal58(data: ReceiptData): string {
  return receiptTemplate(data, 384);
}

// ─── Receipt Template (80mm) ──────────────────────────────────

export function receiptThermal80(data: ReceiptData): string {
  return receiptTemplate(data, 576);
}

function receiptTemplate(data: ReceiptData, widthPx: number): string {
  const { order, branding, qrDataUrl } = data;

  const logoSection = branding?.logoMonochromeUrl
    ? `<div class="logo-container"><img src="${escapeHtml(branding.logoMonochromeUrl)}" alt="Logo" /></div>`
    : branding?.displayName
      ? `<div class="logo-container"><span class="logo-text">${escapeHtml(branding.displayName)}</span></div>`
      : branding?.fallbackText
        ? `<div class="logo-container"><span class="logo-text">${escapeHtml(branding.fallbackText)}</span></div>`
        : "";

  const eventTitle = order.event?.title
    ? escapeHtml(order.event.title)
    : "Purchase";

  const ticketLines = (order.tickets || [])
    .map(
      (t) =>
        `<div class="row"><span class="row-label">${escapeHtml(t.ticketTypeName)}</span><span class="row-value">×1</span></div>`,
    )
    .join("\n");

  const qrSection = qrDataUrl
    ? `<div class="qr-container"><img src="${qrDataUrl}" alt="QR" /></div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${baseStyles(widthPx)}</head><body>

${logoSection}

<div class="center">
  <h1>${eventTitle}</h1>
</div>

<div class="divider"></div>

<div class="center bold">RECEIPT</div>
<div class="ticket-id">Order: ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
<div class="ticket-id">${formatDate(order.createdAt)}</div>

<div class="divider"></div>

${ticketLines || `<div class="row"><span class="row-label">${escapeHtml(order.type.replace(/_/g, " "))}</span><span class="row-value">×1</span></div>`}

<div class="divider"></div>

<div class="row"><span class="row-label">Subtotal</span><span class="row-value">${formatCents(order.fees.subtotalCents)}</span></div>
${order.fees.platformFeeCents > 0 ? `<div class="row"><span class="row-label">Service Fee</span><span class="row-value">${formatCents(order.fees.platformFeeCents)}</span></div>` : ""}
${order.fees.taxCents > 0 ? `<div class="row"><span class="row-label">Tax</span><span class="row-value">${formatCents(order.fees.taxCents)}</span></div>` : ""}

<div class="thick-divider"></div>

<div class="total-row">
  <span>TOTAL</span>
  <span>${formatCents(order.fees.totalCents)}</span>
</div>

<div class="divider"></div>

${order.paymentMethodBrand ? `<div class="row"><span class="row-label">Paid with</span><span class="row-value">${escapeHtml(order.paymentMethodBrand)} ••${escapeHtml(order.paymentMethodLast4 || "")}</span></div>` : ""}

${qrSection}

<div class="footer">
  <div>${DVNT_LOGO_TEXT}</div>
  <div>dvntapp.live</div>
  <div>Thank you!</div>
</div>

<div class="cut-line"></div>

</body></html>`;
}

// ─── Ticket Template (Thermal) ────────────────────────────────

export function ticketThermal58(data: ReceiptData): string {
  return ticketTemplate(data, 384);
}

export function ticketThermal80(data: ReceiptData): string {
  return ticketTemplate(data, 576);
}

function ticketTemplate(data: ReceiptData, widthPx: number): string {
  const { order, branding, qrDataUrl } = data;

  const logoSection = branding?.logoMonochromeUrl
    ? `<div class="logo-container"><img src="${escapeHtml(branding.logoMonochromeUrl)}" alt="Logo" /></div>`
    : branding?.displayName
      ? `<div class="logo-container"><span class="logo-text">${escapeHtml(branding.displayName)}</span></div>`
      : "";

  const eventTitle = order.event?.title
    ? escapeHtml(order.event.title)
    : "Event";
  const eventDate = order.event?.startDate
    ? formatDate(order.event.startDate)
    : "";
  const eventLocation = order.event?.location
    ? escapeHtml(order.event.location)
    : "";

  const ticket = order.tickets?.[0];
  const ticketType = ticket?.ticketTypeName || "General Admission";

  const qrSection = qrDataUrl
    ? `<div class="qr-container"><img src="${qrDataUrl}" alt="QR" /><div style="font-size:10px;margin-top:4px;">Scan for entry</div></div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${baseStyles(widthPx)}</head><body>

${logoSection}

<div class="center">
  <h1>${eventTitle}</h1>
  ${eventDate ? `<div>${eventDate}</div>` : ""}
  ${eventLocation ? `<div>${eventLocation}</div>` : ""}
</div>

<div class="thick-divider"></div>

<div class="center bold" style="font-size:16px;">${escapeHtml(ticketType)}</div>

${qrSection}

${ticket ? `<div class="ticket-id">Ticket: ${escapeHtml(ticket.id.slice(0, 8).toUpperCase())}</div>` : ""}

<div class="divider"></div>

<div class="footer">
  <div>Powered by ${DVNT_LOGO_TEXT}</div>
</div>

<div class="cut-line"></div>

</body></html>`;
}

// ─── Standard PDF Receipt (A4/Letter) ─────────────────────────

export function receiptPdfHtml(data: ReceiptData): string {
  const { order, branding } = data;
  const fees = order.fees || {
    subtotalCents: 0,
    platformFeeCents: 0,
    processingFeeCents: 0,
    taxCents: 0,
    totalCents: 0,
  };
  const eventTitle = order.event?.title || "Purchase";

  const dvntLogoHtml = `<div style="font-size:24px;font-weight:900;letter-spacing:3px;color:#8A40CF;">DVNT</div>`;

  const sellerLogoHtml = branding?.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" style="max-height:40px;max-width:160px;" />`
    : branding?.displayName
      ? `<div style="font-size:14px;font-weight:600;">${escapeHtml(branding.displayName)}</div>`
      : "";

  const ticketRows = (order.tickets || [])
    .map(
      (t) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(t.ticketTypeName)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">1</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatCents(fees.subtotalCents / (order.tickets?.length || 1))}</td>
    </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; padding: 40px 32px; color: #1a1a1a; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .invoice-title { font-size: 28px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .meta { color: #666; font-size: 13px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th { text-align: left; padding: 10px 0; border-bottom: 2px solid #111; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
  th:nth-child(2) { text-align: center; }
  th:last-child { text-align: right; }
  .totals { margin-top: 16px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .totals .total { font-size: 18px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; margin-top: 8px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 11px; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .status-paid { background: rgba(34,197,94,0.1); color: #16a34a; }
  .status-refunded { background: rgba(168,85,247,0.1); color: #9333ea; }
</style></head><body>

<div class="header">
  <div>
    ${dvntLogoHtml}
    <div class="invoice-title">Receipt</div>
    <div class="meta">
      Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}<br/>
      ${formatDate(order.createdAt)}<br/>
      <span class="status-badge status-${order.status === "refunded" ? "refunded" : "paid"}">${order.status === "refunded" ? "Refunded" : "Paid"}</span>
    </div>
  </div>
  <div style="text-align:right;">
    ${sellerLogoHtml}
  </div>
</div>

<div style="margin-bottom:24px;">
  <div style="font-size:16px;font-weight:600;">${escapeHtml(eventTitle)}</div>
  ${order.event?.startDate ? `<div class="meta">${formatDate(order.event.startDate)}</div>` : ""}
  ${order.event?.location ? `<div class="meta">${escapeHtml(order.event.location)}</div>` : ""}
</div>

<table>
  <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
  <tbody>
    ${ticketRows || `<tr><td style="padding:8px 0;">${escapeHtml(order.type.replace(/_/g, " "))}</td><td style="text-align:center;">1</td><td style="text-align:right;">${formatCents(fees.subtotalCents)}</td></tr>`}
  </tbody>
</table>

<div class="totals">
  <div class="row"><span>Subtotal</span><span>${formatCents(fees.subtotalCents)}</span></div>
  ${fees.platformFeeCents > 0 ? `<div class="row"><span>Service Fee</span><span>${formatCents(fees.platformFeeCents)}</span></div>` : ""}
  ${fees.processingFeeCents > 0 ? `<div class="row"><span>Processing</span><span>${formatCents(fees.processingFeeCents)}</span></div>` : ""}
  ${fees.taxCents > 0 ? `<div class="row"><span>Tax</span><span>${formatCents(fees.taxCents)}</span></div>` : ""}
  <div class="row total"><span>Total</span><span>${formatCents(fees.totalCents)}</span></div>
</div>

${order.paymentMethodBrand ? `<div style="margin-top:16px;font-size:13px;color:#666;">Paid with ${escapeHtml(order.paymentMethodBrand)} ending in ${escapeHtml(order.paymentMethodLast4 || "")}</div>` : ""}

<div class="footer">
  <div>DVNT — dvntapp.live</div>
  <div>This receipt was generated automatically. For support, contact support@dvntapp.live</div>
</div>

</body></html>`;
}
