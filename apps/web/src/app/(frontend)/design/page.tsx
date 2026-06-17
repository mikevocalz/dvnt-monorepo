'use client';

// Design Wave 2 verification harness — renders the shared event primitives
// (EventFlyer precedence + GoingRow blur-gate) in their key states so the design
// can be checked on a real device. Sample data only; not a production route.

import { create } from 'zustand';
import { FeedEventCard, type FeedEventCardData } from '@dvnt/app/components/event/FeedEventCard.web';
import { TicketTierCard, type TierCardData } from '@dvnt/app/components/event/TicketTierCard.web';
import { WebAppHeader } from '@dvnt/app/components/web-app-header.web';
import { resolveCurrentPriceCents } from '@dvnt/app/lib/tickets/pricing';
import { GoingAccordion, type EventAttendee } from '@dvnt/app/components/event/GoingAccordion.web';
import { EventFlyer } from '@dvnt/app/components/event/EventFlyer.web';
import { WalletGroupCard, type WalletGroupCardData } from '@dvnt/app/components/event/WalletGroupCard.web';
import { GuestTicketView } from '@dvnt/app/components/event/GuestTicketView.web';
import { color, gradient } from '@dvnt/app/lib/theme';

const GROUP_ORDER: WalletGroupCardData = {
  orderId: 'ord_1', eventTitle: 'Midnight Aura', dateLabel: 'Fri Jun 20 · 10pm · Elsewhere',
  media: { title: 'Midnight Aura', dominantColor: '#3a1d5e', staticFlyerUrl: 'https://picsum.photos/seed/aura/200/160' },
  tickets: [
    { id: 't1', order_index: 1, order_count: 5, attendee_name: 'Jane', tier: 'vip', status: 'checked_in' },
    { id: 't2', order_index: 2, order_count: 5, attendee_name: 'Mateo', tier: 'ga', status: 'active' },
    { id: 't3', order_index: 3, order_count: 5, attendee_name: null, tier: 'ga', status: 'claimed', claimed_by: 'Sol' },
    { id: 't4', order_index: 4, order_count: 5, attendee_name: null, tier: 'ga', status: 'active' },
    { id: 't5', order_index: 5, order_count: 5, attendee_name: null, tier: 'ga', status: 'active' },
  ],
};

const ATTENDEES: EventAttendee[] = ['ava', 'mateo', 'sol', 'nia', 'kai', 'remy', 'zoe', 'theo'].map((u, i) => ({
  id: String(i), username: u, avatar: `https://i.pravatar.cc/96?img=${i + 11}`,
}));

// Tiny demo selection store (Zustand-always rule; showcase harness).
const useSel = create<{ id: string | null; set: (id: string) => void }>((s) => ({
  id: 'eb', set: (id) => s({ id }),
}));

const dollars = (cents: number) => Math.round(cents / 100);

// Source tiers (cents, with the v2 fields) → current price resolved via the
// shared pricing module, mapped to the TicketTierCard display shape.
const SRC = [
  { id: 'ga', tier: 'ga', name: 'General Admission', glowColor: '#3FDCFF', price_cents: 2500, quantity_total: 200, quantity_sold: 60, remaining: 140, perks: ['Entry all night'] },
  { id: 'eb', tier: 'early_bird', name: 'Early Bird', glowColor: '#F5C518', price_cents: 4000, quantity_total: 300, quantity_sold: 92, remaining: 108,
    sub_allocations: [{ quantity: 100, price_cents: 3000 }, { quantity: 100, price_cents: 4000 }], originalPriceCents: 4000, perks: ['Reduced price', 'Limited release'] },
  { id: 'vip', tier: 'vip', name: 'VIP Table', glowColor: '#FF5BFC', price_cents: 40000, quantity_total: 10, quantity_sold: 9, remaining: 1, perks: ['Bottle service', 'Reserved table', 'Skip the line'] },
  { id: 'gone', tier: 'ga', name: 'Floor', glowColor: '#3FDCFF', price_cents: 3000, quantity_total: 50, quantity_sold: 50, remaining: 0, isSoldOut: true, perks: [] },
];

const TIER_CARDS: TierCardData[] = SRC.map((t) => {
  const current = resolveCurrentPriceCents(t as any);
  return {
    id: t.id, tier: t.tier, category: 'admission', name: t.name, glowColor: t.glowColor,
    price: dollars(current),
    originalPrice: (t as any).originalPriceCents && (t as any).originalPriceCents > current ? dollars((t as any).originalPriceCents) : null,
    perks: t.perks, remaining: t.remaining, isSoldOut: t.isSoldOut,
  };
});

function TierSelector() {
  const sel = useSel((s) => s.id);
  const set = useSel((s) => s.set);
  return (
    <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: 8, maxWidth: 480, margin: '0 auto' }}>
      {TIER_CARDS.map((t) => (
        <TicketTierCard key={t.id} tier={t} isSelected={sel === t.id} onSelect={(x) => set(x.id)} />
      ))}
    </div>
  );
}

const CARDS: FeedEventCardData[] = [
  {
    id: '1', slug: 'midnight-aura', title: 'Midnight Aura', category: 'Nightlife',
    dateDay: '20', month: 'Jun', location: 'Elsewhere', time: '10pm', attendeeCount: 42,
    media: { title: 'Midnight Aura', dominantColor: '#3a1d5e', staticFlyerUrl: 'https://picsum.photos/seed/aura/600/400' },
  },
  {
    id: '2', slug: 'neon-garden', title: 'Neon Garden', category: 'House', promoted: true,
    dateDay: '21', month: 'Jun', location: 'The Brooklyn Mirage', time: '9pm', attendeeCount: 128,
    media: { title: 'Neon Garden', dominantColor: '#0e3b46', staticFlyerUrl: 'https://picsum.photos/seed/neon/600/400' },
  },
  {
    id: '3', slug: 'basement-tapes', title: 'Basement Tapes Vol. 4', // no media → generated fallback
    dateDay: '19', month: 'Jun', location: 'TBA', time: '11pm', attendeeCount: 2,
    media: { title: 'Basement Tapes Vol. 4', dominantColor: '#5b2c81' },
  },
  {
    id: '4', slug: 'sunrise-set', title: 'Sunrise Set', category: 'Techno', cancelled: true,
    dateDay: '22', month: 'Jun', location: 'Rooftop', time: '5am', attendeeCount: 0,
    media: { title: 'Sunrise Set', dominantColor: '#874e9f', staticFlyerUrl: 'https://picsum.photos/seed/sun/600/400' },
  },
];

export default function DesignPreview() {
  return (
    <div style={{ minHeight: '100dvh', background: color.ink }}>
      <WebAppHeader />
      <main style={{ padding: '20px 14px 56px' }}>
      <h1
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 22,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '4px 0 4px',
        }}
      >
        Design Wave 2 — feed
      </h1>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 18px' }}>
        EventFlyer precedence · the blur-gated going row (logged-out) · promoted slot · generated fallback
      </p>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        {CARDS.map((c) => (
          <FeedEventCard key={c.id} data={c} />
        ))}
      </div>

      <h2
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 18,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 0 4px',
        }}
      >
        Tier selector
      </h2>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 14px' }}>
        live price · "price goes up" urgency (Early Bird) · 1-left · locked · sold-out
      </p>
      <TierSelector />

      <h2
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 18,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 0 4px',
        }}
      >
        Going row (ported)
      </h2>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 14px' }}>
        ../deviant GoingAccordion — purple container, face pile + "N going" + chevron, 5-col grid expand. Logged-out = blur + "Sign in to see who&apos;s going".
      </p>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <GoingAccordion id="demo" attendees={ATTENDEES} totalCount={42} />
      </div>

      <h2
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 18,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 0 4px',
        }}
      >
        Event detail (composition)
      </h2>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 14px' }}>
        ported primitives composed: flyer hero · going accordion · tier cards · sticky buy bar
      </p>
      <div style={{ maxWidth: 460, margin: '0 auto', position: 'relative', paddingBottom: 72 }}>
        <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 14 }}>
          <EventFlyer media={{ title: 'Midnight Aura', dominantColor: '#3a1d5e', staticFlyerUrl: 'https://picsum.photos/seed/aura/600/700' }} autoplay aspect={5 / 4} rounded={16} />
        </div>
        <h3 style={{ margin: 0, fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 800, fontSize: 24, color: color.text, textTransform: 'uppercase' }}>Midnight Aura</h3>
        <p style={{ margin: '4px 0 14px', color: color.textDim, fontSize: 14 }}>Fri Jun 20 · 10pm · Elsewhere, Brooklyn</p>
        <GoingAccordion id="detail" attendees={ATTENDEES} totalCount={42} />
        <div style={{ height: 14 }} />
        <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: 8 }}>
          {TIER_CARDS.map((t) => (
            <TicketTierCard key={t.id} tier={t} isSelected={t.id === 'eb'} onSelect={() => {}} />
          ))}
        </div>
        {/* sticky buy bar */}
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '12px 14px', borderRadius: 16,
            background: 'rgba(8,10,18,0.72)', backdropFilter: 'saturate(160%) blur(18px)',
            border: `1px solid ${color.hairline}`,
          }}
        >
          <span style={{ fontFamily: 'SpaceMono, ui-monospace, monospace', fontSize: 13, color: color.textDim }}>
            from <span style={{ color: color.text, fontWeight: 700 }}>$30</span>
          </span>
          <button style={{ border: 0, borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700, color: color.ink, background: gradient.deviantCss, cursor: 'pointer' }}>
            Get tickets
          </button>
        </div>
      </div>

      <h2
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 18,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 0 4px',
        }}
      >
        Wallet — group order
      </h2>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 14px' }}>
        one card → 5 tickets; expand for "Ticket N of 5", per-child QR, name, checked-in / sent / open
      </p>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <WalletGroupCard data={GROUP_ORDER} />
      </div>

      <h2
        style={{
          fontFamily: 'SpaceGrotesk, system-ui, sans-serif', fontWeight: 700, fontSize: 18,
          color: color.text, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 0 4px',
        }}
      >
        Guest ticket view — /t/&#123;token&#125;
      </h2>
      <p style={{ color: color.textDim, fontSize: 13, margin: '0 0 14px' }}>
        no-login flagship surface (data from get_guest_ticket_view): live event · N-of-M · QR · add-to-wallet · claim CTA
      </p>
      <div style={{ maxWidth: 420, margin: '0 auto', borderRadius: 20, overflow: 'hidden', border: `1px solid ${color.hairline}` }}>
        <GuestTicketView data={{
          event: { title: 'Midnight Aura', dateLabel: 'Fri Jun 20 · 10pm', location: 'Elsewhere, Brooklyn',
            media: { title: 'Midnight Aura', dominantColor: '#3a1d5e', staticFlyerUrl: 'https://picsum.photos/seed/aura/420/520' } },
          ticket: { order_index: 2, order_count: 5, attendee_name: 'Mateo', tier_name: 'VIP', status: 'active', qr_payload: 'hmac' },
          addons: [{ id: 'a1', name: 'Coat check', quantity: 1 }],
        }} />
      </div>
      </main>
    </div>
  );
}
