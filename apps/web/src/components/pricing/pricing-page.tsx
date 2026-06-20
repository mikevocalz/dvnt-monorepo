'use client';

/**
 * DVNT pricing / membership paywall (web). Renders the membership tiers from the
 * shared subscription model (packages/app/lib/subscription) with VIP flagged as
 * "Most Popular", plus the standalone Sneaky Lynk tiers. Purchasing is gated:
 * a logged-out visitor is always routed to /auth/login first (no anonymous
 * checkout). A logged-in member starts a web Stripe Checkout (reader-app
 * pattern — selling happens on the web, the native app only reads entitlements).
 */
import { useState } from 'react';
import { useRouter } from 'solito/navigation';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import {
  PLANS,
  MEMBERSHIP_PLAN_KEYS,
  SNEAKY_PLAN_KEYS,
  type PlanKey,
} from '@dvnt/app/lib/subscription';

// Clean sans for headings/prices — Republica-Minor reads badly at heading
// sizes with tracking, so use the system sans here.
const DISPLAY = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Hide Founders Circle on /pricing until partnership benefits are secured.
const VISIBLE_MEMBERSHIP_PLAN_KEYS = MEMBERSHIP_PLAN_KEYS.filter(
  (key) => key !== 'dvnt_founders_circle',
);

function priceLabel(cents: number) {
  if (cents === 0) return '$0';
  const dollars = cents / 100;
  return `$${cents % 100 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export function PricingPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [pending, setPending] = useState<PlanKey | null>(null);

  // The gate: no account → login. With an account → web Stripe Checkout.
  async function choosePlan(planKey: PlanKey) {
    if (planKey === 'free') {
      router.push(isAuthenticated ? '/' : '/auth/signup');
      return;
    }
    if (!isAuthenticated) {
      // Don't allow purchasing without an account — direct them to login.
      router.push(`/auth/login?next=${encodeURIComponent('/pricing')}`);
      return;
    }
    try {
      setPending(planKey);
      // Web Stripe Checkout via the Supabase edge function (reader-app pattern).
      // The function authenticates the user from the Better Auth session token in
      // `x-auth-token` (verifySession); Authorization carries the anon JWT so the
      // Supabase gateway accepts the request.
      const { requireBetterAuthToken } = await import(
        '@dvnt/app/lib/auth/identity'
      );
      const authToken = await requireBetterAuthToken();
      const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${base}/functions/v1/membership-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
          'x-auth-token': authToken,
        },
        body: JSON.stringify({ plan_key: planKey }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
      else throw new Error('No checkout URL returned');
    } catch (e) {
      console.error('[pricing] checkout failed', e);
      alert('Checkout is not available yet. Please try again shortly.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={shell}>
      <main>
        <section style={{ padding: '156px 24px 8px', textAlign: 'center' }}>
          <p style={kicker}>DVNT Membership</p>
          <h1 style={title}>REAL PEOPLE. REAL CONNECTIONS.</h1>
          <p style={intro}>
            DVNT Membership unlocks the best of our app and events. Connect digitally.
            Experience life together. Every membership includes Sneaky Lynk access.
          </p>
        </section>

        <section style={{ padding: '28px 24px 8px' }}>
          <div style={membershipGrid}>
            {VISIBLE_MEMBERSHIP_PLAN_KEYS.map((key) => {
              const p = PLANS[key];
              return (
                <article
                  key={key}
                  className={`dvnt-plan${p.recommended ? ' is-rec' : ''}`}
                  style={{ ...planCard, ...(p.recommended ? planCardRec : null) }}
                >
                  {p.recommended ? <span style={popular}>Most Popular</span> : null}
                  <div style={planInner}>
                    <h2 style={planName}>{p.name}</h2>
                    <div style={planPriceRow}>
                      <span style={planPrice}>{priceLabel(p.priceCents)}</span>
                      <span style={planPer}>/month</span>
                    </div>
                    {p.positioning ? <p style={planPos}>{p.positioning}</p> : null}

                    <div style={{ flex: 1 }}>
                      <FeatureList label="Sneaky Lynk" items={p.bullets.sneaky} accent="#3FDCFF" />
                      {p.bullets.events.length ? (
                        <FeatureList label="Events" items={p.bullets.events} accent="#FF5BFC" />
                      ) : null}
                    </div>

                    <button
                      type="button"
                      disabled={pending === key}
                      onClick={() => choosePlan(key)}
                      style={{ ...cta, ...(p.recommended ? ctaRec : key === 'free' ? ctaGhost : null) }}
                    >
                      {pending === key
                        ? 'Starting…'
                        : key === 'free'
                          ? 'Get started'
                          : p.recommended
                            ? 'Get VIP'
                            : 'Become a member'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Standalone Sneaky Lynk */}
        <section style={{ padding: '48px 24px 96px' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto' }}>
            <p style={{ ...kicker, textAlign: 'left' }}>Sneaky Lynk only</p>
            <h2 style={sneakyHead}>Just here for the video rooms?</h2>
            <div style={sneakyGrid}>
              {SNEAKY_PLAN_KEYS.map((key) => {
                const p = PLANS[key];
                return (
                  <article key={key} style={sneakyCard}>
                    <h3 style={planName}>{p.name}</h3>
                    <div style={planPriceRow}>
                      <span style={{ ...planPrice, fontSize: 30 }}>{priceLabel(p.priceCents)}</span>
                      <span style={planPer}>/month</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <FeatureList label="" items={p.bullets.sneaky} accent="#8A40CF" />
                    </div>
                    <button
                      type="button"
                      disabled={pending === key}
                      onClick={() => choosePlan(key)}
                      style={{ ...cta, ...(key === 'free' ? ctaGhost : null) }}
                    >
                      {key === 'free' ? 'Get started' : pending === key ? 'Starting…' : 'Choose plan'}
                    </button>
                  </article>
                );
              })}
            </div>
            <p style={note}>
              A DVNT Membership already includes Sneaky Lynk — pick a membership above for events too.
            </p>
          </div>
        </section>
      </main>
      <style>{CSS}</style>
    </div>
  );
}

function FeatureList({ label, items, accent }: { label: string; items: string[]; accent: string }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      {label ? <span style={{ ...featLabel, color: accent }}>{label}</span> : null}
      <ul style={featList}>
        {items.map((i) => (
          <li key={i} style={featItem}>
            <span style={{ ...check, color: accent }}>✓</span>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CSS = `
.dvnt-plan { transition: transform .3s cubic-bezier(0.22,1,0.36,1), box-shadow .3s ease; }
.dvnt-plan:hover { transform: translateY(-6px); box-shadow: 0 30px 70px rgba(0,0,0,0.5); }
.dvnt-plan.is-rec { animation: dvntRecGlow 4s ease infinite; }
@keyframes dvntRecGlow {
  0%,100% { box-shadow: 0 0 0 1px rgba(255,91,252,0.5), 0 24px 60px rgba(138,64,207,0.35); }
  50% { box-shadow: 0 0 0 1px rgba(63,220,255,0.6), 0 28px 70px rgba(255,91,252,0.4); }
}
@media (prefers-reduced-motion: reduce){ .dvnt-plan,.dvnt-plan.is-rec{ animation:none; transition:none } }`;

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background:
    'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.30) 0%, rgba(124,58,237,0.12) 38%, rgba(2,3,10,0) 78%), #02030A',
  color: '#FAFAF9',
};
const kicker: React.CSSProperties = { margin: 0, color: '#3FDCFF', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' };
const title: React.CSSProperties = { margin: '14px auto 0', maxWidth: 880, fontFamily: DISPLAY, fontSize: 'clamp(32px,5.5vw,64px)', lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.02em' };
const intro: React.CSSProperties = { margin: '20px auto 0', maxWidth: 640, color: 'rgba(245,245,244,0.78)', fontSize: 17, lineHeight: '27px' };
const membershipGrid: React.CSSProperties = { maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, alignItems: 'stretch' };
const planCard: React.CSSProperties = { position: 'relative', borderRadius: 22, border: '1px solid rgba(255,255,255,0.12)', background: 'linear-gradient(165deg, rgba(20,22,34,0.95), rgba(8,10,18,0.96))', padding: 2 };
const planCardRec: React.CSSProperties = { background: 'linear-gradient(135deg,#3FDCFF,#FF5BFC,#8A40CF,#3FDCFF)', backgroundSize: '300% 300%' };
const planInner: React.CSSProperties = { height: '100%', borderRadius: 20, background: 'linear-gradient(165deg, rgba(20,22,34,0.97), rgba(8,10,18,0.98))', padding: '24px 20px', display: 'flex', flexDirection: 'column' };
const popular: React.CSSProperties = { position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', zIndex: 2, padding: '6px 14px', borderRadius: 10, fontFamily: 'monospace', fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', whiteSpace: 'nowrap', color: '#0A0118', background: 'linear-gradient(120deg,#3FDCFF,#FF5BFC)' };
// Short tier labels — the brand Republica-Minor reads great here (uppercase).
const planName: React.CSSProperties = { margin: 0, fontFamily: '"Republica-Minor", system-ui, sans-serif', fontSize: 24, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' };
const planPriceRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 };
const planPrice: React.CSSProperties = { fontFamily: DISPLAY, fontSize: 38, fontWeight: 800, letterSpacing: '-0.01em' };
const planPer: React.CSSProperties = { color: 'rgba(245,245,244,0.6)', fontSize: 14 };
const planPos: React.CSSProperties = { margin: '8px 0 0', color: 'rgba(245,245,244,0.7)', fontSize: 14, lineHeight: '20px' };
const featLabel: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' };
const featList: React.CSSProperties = { listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 7 };
const featItem: React.CSSProperties = { position: 'relative', paddingLeft: 22, fontSize: 13.5, lineHeight: '20px', color: 'rgba(245,245,244,0.82)' };
const check: React.CSSProperties = { position: 'absolute', left: 0, top: 0, fontWeight: 800 };
const cta: React.CSSProperties = { marginTop: 24, appearance: 'none', cursor: 'pointer', border: '1px solid transparent', width: '100%', padding: '12px 14px', borderRadius: 13, fontWeight: 800, fontSize: 14, color: '#0A0118', background: 'linear-gradient(135deg,#8A40CF,#FF5BFC)', marginBottom: 0 };
const ctaRec: React.CSSProperties = { background: 'linear-gradient(135deg,#3FDCFF,#FF5BFC)' };
const ctaGhost: React.CSSProperties = { background: 'transparent', color: '#FAFAF9', border: '1px solid rgba(255,255,255,0.2)' };
const sneakyHead: React.CSSProperties = { margin: '12px 0 22px', fontFamily: DISPLAY, fontSize: 'clamp(24px,3.4vw,38px)', fontWeight: 800, letterSpacing: '-0.01em' };
const sneakyGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 };
const sneakyCard: React.CSSProperties = { borderRadius: 18, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(18,20,30,0.7)', padding: 22, display: 'flex', flexDirection: 'column' };
const note: React.CSSProperties = { margin: '22px 0 0', color: 'rgba(245,245,244,0.55)', fontSize: 13 };
