/** Synthetic previews only. No send/provider calls and no real credentials. */
globalThis.Deno ??= { env: { get: () => undefined } };
const templates = await import('./templates.ts');
const { buildFollowupEmail } = await import('../event-followup.ts');
const url = 'https://example.test/action?token=preview-only&source=email';
export const fixtures = {
  verification: templates.verificationCode('123456'),
  reminderAddons: templates.ticketConfirmation({
    eventTitle: 'Reminder preview', heading: "It's almost time.",
    subject: 'Reminder preview — starts in 3 hours', claimUrl: null,
    greeting: 'Your event starts soon. Open each ticket and add-on below.',
    tickets: [{ tier: 'ga', tierLabel: 'Admission', lookupUrl: url }, { tier: 'service', tierLabel: 'Coat check pass', lookupUrl: url }],
    addons: [{ name: 'Separate coat check', quantity: 2, status: 'unfulfilled', lookupUrl: url }],
    manageUrl: url,
  }),
  transfer: templates.ticketConfirmation({
    eventTitle: 'Preview “Night Out”', dateLine: 'Sun, Nov 1, 2:00 AM', location: 'Preview Venue',
    greeting: '@preview_host sent you a ticket for Preview “Night Out” — it\'s yours now.',
    tickets: [{ tier: 'ga', tierLabel: 'INFLUENCER' }], manageUrl: url,
  }),
  comp: templates.ticketConfirmation({
    eventTitle: 'Complimentary preview', tickets: [{ tier: 'comp', tierLabel: 'COMP', note: 'Guest of the host' }], manageUrl: url,
  }),
  guest: templates.ticketConfirmation({
    eventTitle: 'Guest preview <special> & friends', toEmail: 'preview@example.test', guestNudge: true,
    tickets: [{ tier: 'vip', qrToken: 'PREVIEW-ONLY-QR<&>', lookupUrl: url, walletUrl: url }],
    manageUrl: url, summary: [{ label: 'Total', value: '$20.00', strong: true }],
  }),
  multiple: templates.ticketConfirmation({
    eventTitle: 'Multiple ticket preview',
    tickets: ['free', 'ga', 'vip', 'table', 'comp'].map((tier, i) => ({ tier, qrToken: `PREVIEW-${i}`, lookupUrl: url })),
  }),
  broadcast: templates.broadcast({ eventTitle: 'Preview Event', message: 'First line\nSecond <line> & more', hostName: 'Preview Host', ctaUrl: url, ctaLabel: 'Open event' }),
  payout: templates.payoutStatement({ eventTitle: 'Preview Event', ticketsSold: 2, ticketsRefunded: 1, grossCents: 4000, refundsCents: 2000, feeCents: 200, netCents: 1800 }),
  welcome: templates.welcome(),
  welcomeCheckout: templates.welcome(null, { checkoutProfile: true }),
  promoter: templates.promoterInvite({ eventId: 42, eventTitle: 'Preview Event', hostHandle: '@preview', code: 'PREVIEW' }),
  magicLink: templates.magicLinkEmail(url),
  linked: templates.accountLinked('Preview', { provider: 'Google', email: 'preview@example.test' }),
  reset: templates.resetPassword(url),
  verifyLink: templates.verifyEmailLink(url, 'Preview'),
  verifyAlias: templates.verifyEmail(url, 'Preview'),
  followupMember: buildFollowupEmail({
    eventTitle: 'Synthetic Community Night', subject: 'How was your night?',
    message: 'Thanks for celebrating with us. Tell us what worked and what could be better.\n\nShare photos, meet people and find another event. This is synthetic preview copy, not a real campaign.',
    ctaLabel: 'Rate the party', reviewUrl: 'https://example.test/public/events/7?section=reviews',
    unsubscribeUrl: 'https://example.test/unsubscribe?token=synthetic-preview', preview: true,
  }),
  followupGuest: buildFollowupEmail({
    eventTitle: 'Synthetic Community Night', subject: 'Stay connected',
    message: 'Make a profile and connect with the community. Share your photos and discover future events. This is synthetic preview copy, not a real campaign.',
    ctaLabel: 'Rate the party', reviewUrl: 'https://example.test/public/events/7?section=reviews',
    joinUrl: 'https://example.test/auth/signup?returnTo=%2Ffeed%2Fevents%2F7%3Fsection%3Dreviews',
    unsubscribeUrl: 'https://example.test/unsubscribe?token=synthetic-preview', preview: true,
  }),
  followup: buildFollowupEmail({ eventTitle: 'Preview Event', subject: null, message: 'Thanks for coming.\nSee you next time.', ctaLabel: null, reviewUrl: url, unsubscribeUrl: 'https://example.test/unsubscribe?token=preview-only' }),
};
export { templates };
