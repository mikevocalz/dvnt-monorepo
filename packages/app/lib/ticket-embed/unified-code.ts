/** Both external ticket sale modes use the single event-owned widget UUID. */
const WIDGET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function onSiteTicketEmbedCode(widgetId: string): string {
 if (!WIDGET_ID.test(widgetId)) throw new Error('Invalid event widget ID');
 // The host script creates the event's selection iframe and mounts Stripe in
 // the website's own document; secret payment data never enter the iframe.
 return `<div data-dvnt-ticket-embed="${widgetId}"></div>\n<script async src="https://dvntapp.live/embed/tickets.js"></script>`;
}
