'use client';

/**
 * Privacy + FAQ legal pages — ported from the retired web-vite LegalPage and
 * upgraded for the Next port. Renders the legal content over a deviant gradient
 * shell with glass cards that lift on hover and stagger in. FAQ items are
 * accordions. All content is preserved verbatim from the vite version. The
 * shared GlassHeader + Footer come from the (marketing) route-group layout.
 */
import { useState } from 'react';

// Brand display font (wordmark-style) for the big page title only.
const DISPLAY = '"Republica-Minor", system-ui, sans-serif';
// Clean, readable sans for headings/body — Republica-Minor reads badly at
// heading sizes with tracking, so card titles use the system sans.
const SANS = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

type Section = { title: string; body?: string; items?: string[] };
type FaqGroup = { title: string; items: { question: string; answer: string }[] };

export function LegalPage({ variant }: { variant: 'privacy' | 'faq' }) {
  return (
    <div style={shell}>
      <main>
        {variant === 'privacy' ? <PolicyContent /> : <FaqContent />}
      </main>
      <style>{CSS}</style>
    </div>
  );
}

/* ── Header ── */
function PageHead({ kicker, title, intro }: { kicker: string; title: string; intro: string }) {
  return (
    <section style={{ padding: '156px 24px 40px' }}>
      <div style={wrap}>
        <p className="dvnt-legal-rise" style={kickerStyle}>{kicker}</p>
        <h1 className="dvnt-legal-rise" style={titleStyle}>{title}</h1>
        <p className="dvnt-legal-rise" style={introStyle}>{intro}</p>
      </div>
    </section>
  );
}

/* ── Glass card ── */
function GlassCard({ title, body, items, accent = '#3FDCFF' }: Section & { accent?: string }) {
  return (
    <article className="dvnt-legal-card" style={{ ...card, ['--accent' as string]: accent }}>
      <span className="dvnt-legal-edge" />
      <h2 style={cardTitle}>{title}</h2>
      {body ? <p style={cardBody}>{body}</p> : null}
      {items ? (
        <ul style={{ margin: '16px 0 0', paddingLeft: 18, color: 'rgba(245,245,244,0.78)' }}>
          {items.map((i) => (
            <li key={i} style={{ marginBottom: 9, lineHeight: '24px' }}>{i}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/* ── FAQ accordion ── */
function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <article className="dvnt-legal-card" style={{ ...card, ['--accent' as string]: '#FF5BFC', cursor: 'pointer' }} onClick={onToggle}>
      <span className="dvnt-legal-edge" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <h2 style={{ ...cardTitle, fontSize: 19 }}>{q}</h2>
        <span style={{ ...plus, transform: open ? 'rotate(45deg)' : 'none' }}>+</span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .35s cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <p style={{ ...cardBody, marginTop: 12 }}>{a}</p>
        </div>
      </div>
    </article>
  );
}

function PolicyContent() {
  const privacy: Section[] = [
    { title: 'Introduction', body: 'Deviant LLC and Counter Culture Society operate DVNT as a members-only platform for nightlife, community, and curated access. Using DVNT means accepting this policy.' },
    { title: 'Information We Collect', items: ['Account information such as email address, display name, profile photo, bio, and interests.', 'Age and identity verification information, including government-issued ID, selfie or verification video, and verification metadata.', 'Profile and user content you choose to post, including photos, text, comments, and related activity.'] },
    { title: 'Verification Privacy', body: 'Verification data is used to confirm 18+ eligibility, human identity, platform safety, and fraud prevention. It is encrypted, stored separately from profile data, never displayed publicly, never sold, and not used for advertising surveillance.' },
    { title: 'Human-Only Safety', body: 'DVNT maintains a strict human-only policy. Bots, AI-generated profiles, automated accounts, impersonation, and fraudulent access are not allowed.' },
    { title: 'Use and Disclosure', body: 'DVNT uses information to provide the service, enforce community standards, prevent abuse, respond to safety concerns, and comply with legal obligations. DVNT does not sell user data, share data with advertisers, or allow targeted advertising based on personal data.' },
    { title: 'Security, Retention, and Rights', body: 'DVNT uses encryption, secure storage, access controls, audits, and anti-bot systems. Members can request access, correction, deletion, export, or objection to processing. Data is retained only as long as needed for safety, anti-fraud, and compliance.' },
    { title: 'Adults Only', body: 'DVNT is strictly for adults 18 and older. The platform does not knowingly collect information from anyone under 18.' },
    { title: 'Contact', body: 'For privacy, support, verification, or safety questions, contact DeviantEventsDC@gmail.com.' },
  ];
  const terms: Section[] = [
    { title: 'Eligibility and Account Requirements', body: 'Members must be 18+, complete required ID and selfie verification, provide accurate information, keep accounts secure, and follow DVNT community standards.' },
    { title: 'Member Responsibilities', body: 'Members agree not to harass, threaten, discriminate, impersonate others, post illegal content, compromise security, violate privacy, or use bots and automated systems.' },
    { title: 'Content and Platform Rights', body: 'Members retain ownership of content they post and grant DVNT permission to display that content in the platform. DVNT branding, design, and platform content remain protected intellectual property.' },
    { title: 'Accounts, Services, and Disputes', body: 'DVNT may suspend or terminate accounts for violations. Future paid features will be clearly disclosed. Terms are governed by District of Columbia law, with disputes resolved through binding arbitration.' },
  ];
  return (
    <>
      <PageHead kicker="Policy" title="Privacy, safety, and terms." intro="DVNT is built around privacy, autonomy, verification, and protection for a human-only community." />
      <section style={{ padding: '0 24px 96px' }}>
        <div style={wrap}>
          <div style={effective}>Effective January 2026. Last updated January 2026.</div>
          <h2 style={groupLabel}>Privacy Policy</h2>
          <div style={grid}>{privacy.map((s) => <GlassCard key={s.title} {...s} accent="#3FDCFF" />)}</div>
          <h2 style={{ ...groupLabel, marginTop: 40 }}>Terms of Service</h2>
          <div style={grid}>{terms.map((s) => <GlassCard key={s.title} {...s} accent="#8A40CF" />)}</div>
        </div>
      </section>
    </>
  );
}

function FaqContent() {
  const groups: FaqGroup[] = [
    { title: 'Basics', items: [
      { question: 'What is DVNT?', answer: 'DVNT is a free, members-only platform built for Black and Brown LGBTQ+ people, focused on culture, connection, community, and care.' },
      { question: 'Who operates DVNT?', answer: 'DVNT is operated by Deviant LLC and Counter Culture Society.' },
      { question: 'Who can join?', answer: 'DVNT is for adults 18+ who agree to the verification requirements, community standards, privacy policy, and terms of service.' },
      { question: 'How does DVNT keep access community-centered?', answer: 'During beta, DVNT uses closed access connected to people who have attended live events from the Deviant and Counter Culture community network.' },
    ]},
    { title: 'Safety and Community', items: [
      { question: 'What behavior is expected?', answer: 'Members are expected to move with kindness, consent, consideration, and respect for other members.' },
      { question: 'What behavior is prohibited?', answer: 'DVNT does not tolerate racism, anti-Blackness, transphobia, homophobia, femme-phobia, fat-phobia, body shaming, ableism, sexism, xenophobia, HIV stigma, harassment, threats, bullying, doxxing, privacy violations, or involving minors.' },
      { question: 'Can I report someone?', answer: 'Yes. DVNT has in-app reporting tools, and reports are reviewed by the DVNT Safety Team.' },
    ]},
    { title: 'Ads and Monetization', items: [
      { question: 'Is DVNT free?', answer: 'Yes. DVNT is free to join and use.' },
      { question: 'Will DVNT show ads?', answer: 'Yes, but only ethical in-feed ads such as LGBTQ+ events and hosts, queer-owned brands, culturally relevant products, and local community businesses.' },
      { question: 'Will ads interrupt my experience?', answer: 'No. DVNT uses no popups, no forced videos, and no intrusive ads.' },
    ]},
    { title: 'Verification', items: [
      { question: 'Why do I need to verify?', answer: 'Verification keeps DVNT human-only, safer from impersonation and bad actors, 18+, and protective of Black and Brown LGBTQ+ users.' },
      { question: 'What do I need to verify?', answer: 'Members upload a government-issued photo ID and a live selfie.' },
      { question: 'Will anyone see my ID or legal name?', answer: 'No. Legal identity is private, encrypted, stored securely, never shared or displayed, and kept separate from the public DVNT profile.' },
    ]},
    { title: 'Privacy and Support', items: [
      { question: 'Does DVNT sell my data?', answer: 'No. DVNT does not sell data, share data with advertisers, or run targeted ads.' },
      { question: 'Who can see my profile?', answer: 'Members choose their visibility, including public inside DVNT, partially visible, friends-only, or fully private.' },
      { question: 'How does DVNT protect my data?', answer: 'DVNT uses encryption, secure storage, restricted access, safety audits, and anti-bot systems.' },
      { question: 'How do I contact support?', answer: 'Email DeviantEventsDC@gmail.com for verification issues, safety reports, or technical help.' },
    ]},
  ];
  const [open, setOpen] = useState<string | null>('What is DVNT?');
  return (
    <>
      <PageHead kicker="FAQ" title="Questions before you enter." intro="A clear read on membership, verification, safety, privacy, ads, and support." />
      <section style={{ padding: '0 24px 96px' }}>
        <div style={wrap}>
          {groups.map((g) => (
            <section key={g.title} style={{ marginBottom: 34 }}>
              <h2 style={groupLabel}>{g.title}</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {g.items.map((it) => (
                  <FaqItem key={it.question} q={it.question} a={it.answer} open={open === it.question} onToggle={() => setOpen(open === it.question ? null : it.question)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

const CSS = `
.dvnt-legal-card { position: relative; transition: transform .3s cubic-bezier(0.22,1,0.36,1), border-color .3s ease, box-shadow .3s ease; }
.dvnt-legal-card:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--accent) 50%, rgba(255,255,255,0.14)); box-shadow: 0 24px 60px rgba(0,0,0,0.45); }
.dvnt-legal-edge { position:absolute; left:0; top:18px; bottom:18px; width:3px; border-radius:3px; background: var(--accent); opacity:.55; transition: opacity .3s ease; }
.dvnt-legal-card:hover .dvnt-legal-edge { opacity: 1; }
.dvnt-legal-rise { opacity: 0; transform: translateY(16px); animation: dvntLegalRise .7s cubic-bezier(0.22,1,0.36,1) forwards; }
.dvnt-legal-rise:nth-child(2){ animation-delay:.08s } .dvnt-legal-rise:nth-child(3){ animation-delay:.16s }
@keyframes dvntLegalRise { to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce){ .dvnt-legal-rise{ animation:none; opacity:1; transform:none } .dvnt-legal-card{ transition:none } }`;

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background:
    'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.30) 0%, rgba(124,58,237,0.12) 38%, rgba(2,3,10,0) 78%), #02030A',
  color: '#FAFAF9',
};
const wrap: React.CSSProperties = { width: '100%', maxWidth: 1040, margin: '0 auto' };
const kickerStyle: React.CSSProperties = { margin: 0, color: '#3FDCFF', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' };
const titleStyle: React.CSSProperties = { margin: '14px 0 0', maxWidth: 820, fontFamily: SANS, fontSize: 'clamp(38px, 7vw, 76px)', lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.02em' };
const introStyle: React.CSSProperties = { margin: '22px 0 0', maxWidth: 720, color: 'rgba(245,245,244,0.78)', fontSize: 18, lineHeight: '29px' };
const grid: React.CSSProperties = { display: 'grid', gap: 14 };
const effective: React.CSSProperties = { borderLeft: '3px solid #3FDCFF', padding: '4px 0 4px 18px', color: 'rgba(245,245,244,0.70)', fontSize: 14, lineHeight: '22px', marginBottom: 24 };
const groupLabel: React.CSSProperties = { margin: '0 0 16px', color: '#FF5BFC', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' };
const card: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20,
  background: 'rgba(8,10,20,0.72)', backdropFilter: 'saturate(160%) blur(18px)',
  WebkitBackdropFilter: 'saturate(160%) blur(18px)', padding: '22px 24px 22px 30px',
};
const cardTitle: React.CSSProperties = { margin: 0, color: '#FAFAF9', fontFamily: SANS, fontSize: 21, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.01em' };
const cardBody: React.CSSProperties = { margin: '12px 0 0', color: 'rgba(245,245,244,0.78)', fontSize: 15, lineHeight: '25px' };
const plus: React.CSSProperties = { fontFamily: 'monospace', fontSize: 26, lineHeight: '20px', color: '#FF5BFC', transition: 'transform .35s cubic-bezier(0.22,1,0.36,1)', flexShrink: 0 };
