# Organizer event widget: existing-checkout release

This is a usable event/ticket marketing iframe, not Stripe Embedded Checkout. The organizer opens Event → Organizer dashboard → Embed tickets, enters an exact HTTPS website origin, generates code, and copies the iframe. Its real public event flyer, DVNT SVG wordmark and current eligible tier prices appear in a responsive 740px-breakpoint layout.

**Buy tickets on DVNT** opens the existing `/feed/events/:id` checkout entry in a new tab. Selection, fees, offers, authentication, payment and ticket delivery remain the existing site's responsibility. The widget creates no checkout session, order, reservation or charge. Prices are base prices; final availability and fees are confirmed on DVNT. No Stripe keys are exposed or required by the merchant.

The endpoint supports public non-Spicy published ticketed events only. Hidden, private, draft, cancelled, future-unpublished and Spicy events are not exposed. Locked/private tiers are not listed. Disabled or deleted widgets stop serving. Owner/accepted-admin access, exact website origins, optimistic revision checks, RLS and server-only configuration are enforced.

The Next route returns a restrictive CSP with exact `frame-ancestors`; only `/tickets/embed/*` is exempted from the site's X-Frame-Options DENY header. Normal event/checkout/admin routes keep anti-framing protection. The frame runs no JavaScript or form, and its sandbox permits only an isolated new-tab checkout link. The host page is not navigated or restyled.

Tests: actual handler/renderer/route with explicit database/network fixtures; actual new migration in disposable PostgreSQL; Chromium widths 320,390,740,1100, flyer/logo presence, no horizontal overflow, exact-origin rejection, parent-page isolation and new-tab link. Browser checkout navigation is intercepted fixture data, not a real transaction. Existing repository ticket and release suites remain required.

Rollout: apply only `20261011204000_event_ticket_widgets.sql`; deploy only `event-ticket-widget` with its custom Better Auth authorization (gateway JWT false); deploy web. No existing payment function or payment environment changes. Then verify the public frame and organizer code generator on the actual production domain. Rollback: revoke widget records or revert the isolated web change; existing purchases remain untouched.

PR #68 is a separate future upgrade for payment inside the host document. Its genuine sandbox purchase/QR/email/refund requirement is not skipped or replaced by these tests. Do not describe this link-through widget as completed embedded payment.
