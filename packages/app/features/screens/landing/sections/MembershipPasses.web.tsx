/**
 * Membership passes — WEB. The pricing beat, rendered as premium "membership
 * passes" that live stacked like cards in a wallet and FAN OUT on scroll.
 *
 * GSAP/ScrollTrigger drives the splay (translateX + rotateZ + stagger) the first
 * time the section enters the viewport; the window is the default scroller so
 * this composes with the rest of the landing timeline. Hover raises each pass
 * with a realistic shadow + reflective sheen; the recommended CORE plan wears a
 * soft, slowly-flowing gradient border. Reduced-motion / mobile users fall back
 * to a clean vertical column (transforms reset via CSS), and the hook skips the
 * tween entirely under prefers-reduced-motion. Native fallback: MembershipPasses.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

interface Pass {
  key: string;
  tier: string;
  price: string;
  priceNote?: string;
  sub?: string;
  bullets: string[];
  cta: string;
  recommended?: boolean;
}

const PASSES: Pass[] = [
  {
    key: "free",
    tier: "FREE",
    price: "$0",
    priceNote: "/month",
    bullets: [
      "Sneaky Link: 5-minute sessions",
      "Up to 5 people per link",
      "RSVP to free events",
      "Purchase tickets at standard pricing",
    ],
    cta: "Get started",
  },
  {
    key: "core",
    tier: "CORE",
    price: "$25",
    priceNote: "/month",
    sub: "Become a member.",
    recommended: true,
    bullets: ["Better access", "App perks", "Event benefits", "Community access"],
    cta: "Become a member",
  },
];

export function MembershipPasses() {
  const ref = useGsapScope((self, gsapInstance) => {
    const passes = gsapInstance.utils.toArray<HTMLElement>(".dvnt-pass", self);
    if (!passes.length) return;

    const tween = gsapInstance.fromTo(
      passes,
      { y: 60, rotateZ: 0, x: 0, opacity: 0 },
      {
        opacity: 1,
        x: (i: number) => (i - (passes.length - 1) / 2) * 40,
        rotateZ: (i: number) => (i - (passes.length - 1) / 2) * 6,
        y: 0,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: self, start: "top 70%" },
      },
    );

    // Cleanup: kill the ScrollTrigger this section created (gsap.context revert
    // also handles the tween, but we kill explicitly to satisfy the contract).
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      ScrollTrigger.getAll()
        .filter((t) => t.trigger === self)
        .forEach((t) => t.kill());
    };
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="DVNT Membership"
      style={styles.section}
    >
      <style>{CSS}</style>

      <div style={styles.header}>
        <span style={styles.kicker}>DVNT Membership</span>
        <span style={styles.tagline}>REAL PEOPLE. REAL CONNECTIONS.</span>
        <h2 style={styles.headline}>
          DVNT Membership unlocks the best of our app and events.
        </h2>
        <p style={styles.sub}>Connect digitally. Experience life together.</p>
      </div>

      <div className="dvnt-pass-deck" style={styles.deck}>
        {PASSES.map((p) => (
          <div
            key={p.key}
            className={
              "dvnt-pass" + (p.recommended ? " dvnt-pass--rec" : "")
            }
            style={styles.passWrap}
          >
            {p.recommended ? (
              <div className="dvnt-pass-border" style={styles.recBorder}>
                <PassSurface pass={p} />
              </div>
            ) : (
              <div style={styles.surfacePlain}>
                <PassSurface pass={p} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function PassSurface({ pass }: { pass: Pass }) {
  return (
    <div className="dvnt-pass-surface" style={styles.surface}>
      <span className="dvnt-pass-sheen" style={styles.sheen} aria-hidden />

      <div style={styles.passHead}>
        <span style={styles.tier}>{pass.tier}</span>
        {pass.recommended ? (
          <span style={styles.recPill}>Recommended</span>
        ) : null}
      </div>

      <div style={styles.priceRow}>
        <span style={styles.price}>{pass.price}</span>
        {pass.priceNote ? (
          <span style={styles.priceNote}>{pass.priceNote}</span>
        ) : null}
      </div>
      {pass.sub ? <p style={styles.passSub}>{pass.sub}</p> : null}

      <ul style={styles.bullets}>
        {pass.bullets.map((b) => (
          <li key={b} style={styles.bullet}>
            <span style={styles.dot} aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={
          "dvnt-pass-cta" + (pass.recommended ? " dvnt-pass-cta--rec" : "")
        }
        style={pass.recommended ? styles.ctaRec : styles.cta}
      >
        {pass.cta}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    overflow: "hidden",
    paddingTop: 130,
    paddingBottom: 150,
    paddingLeft: 24,
    paddingRight: 24,
    background: "transparent",
  },
  header: {
    position: "relative",
    zIndex: 2,
    maxWidth: 760,
    margin: "0 auto 72px",
    textAlign: "center",
  },
  kicker: {
    display: "inline-block",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 4,
    textTransform: "uppercase",
    color: "#3FDCFF",
    marginBottom: 16,
  },
  tagline: {
    display: "block",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: "#FF5BFC",
    marginBottom: 22,
  },
  headline: {
    margin: 0,
    fontFamily: "Republica-Minor",
    fontWeight: 800,
    fontSize: "clamp(30px, 4.4vw, 52px)",
    lineHeight: 1.08,
    letterSpacing: -1.4,
    color: "#FAFAF9",
  },
  sub: {
    margin: "22px auto 0",
    maxWidth: 520,
    fontSize: 18,
    lineHeight: 1.5,
    color: "rgba(231,229,228,0.66)",
  },
  // The deck: passes overlap (negative margin) so they read as a stack before
  // the GSAP splay; on mobile this collapses to a clean column (see CSS).
  deck: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "center",
    alignItems: "stretch",
    flexWrap: "wrap",
    gap: 0,
    maxWidth: 880,
    margin: "0 auto",
  },
  passWrap: {
    position: "relative",
    width: 340,
    maxWidth: "88vw",
    margin: "0 -20px",
    willChange: "transform, opacity",
  },
  // Recommended: 2px gradient padding wrapper with a slow flowing animation.
  recBorder: {
    position: "relative",
    height: "100%",
    padding: 2,
    borderRadius: 22,
    backgroundImage:
      "linear-gradient(120deg,#3FDCFF,#FF5BFC,#8A40CF,#3FDCFF)",
    backgroundSize: "300% 300%",
    animation: "flow 5s ease infinite",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
  },
  surfacePlain: {
    position: "relative",
    height: "100%",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
  },
  surface: {
    position: "relative",
    overflow: "hidden",
    height: "100%",
    boxSizing: "border-box",
    borderRadius: 20,
    padding: "30px 26px 28px",
    display: "flex",
    flexDirection: "column",
    background:
      "linear-gradient(165deg, rgba(20,22,34,0.95), rgba(8,10,18,0.96))",
  },
  // Reflective edge / sheen — a faint diagonal gradient that brightens on hover.
  sheen: {
    position: "absolute",
    inset: 0,
    borderRadius: 20,
    pointerEvents: "none",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 38%)",
    opacity: 0.6,
    transition: "opacity 0.35s ease",
  },
  passHead: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  tier: {
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: "rgba(231,229,228,0.66)",
  },
  recPill: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#02030A",
    background: "linear-gradient(120deg,#3FDCFF,#FF5BFC)",
    borderRadius: 999,
    padding: "4px 10px",
  },
  priceRow: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },
  price: {
    fontFamily: "Republica-Minor",
    fontSize: 48,
    fontWeight: 800,
    letterSpacing: -1.5,
    color: "#FAFAF9",
    lineHeight: 1,
  },
  priceNote: {
    fontSize: 15,
    fontWeight: 600,
    color: "rgba(231,229,228,0.66)",
  },
  passSub: {
    position: "relative",
    zIndex: 1,
    margin: "12px 0 0",
    fontSize: 15,
    color: "rgba(231,229,228,0.66)",
  },
  bullets: {
    position: "relative",
    zIndex: 1,
    listStyle: "none",
    margin: "26px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 13,
    flex: 1,
  },
  bullet: {
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
    fontSize: 15,
    lineHeight: 1.4,
    color: "#FAFAF9",
  },
  dot: {
    flex: "0 0 auto",
    marginTop: 7,
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "linear-gradient(120deg,#3FDCFF,#FF5BFC)",
    boxShadow: "0 0 10px rgba(63,220,255,0.55)",
  },
  cta: {
    position: "relative",
    zIndex: 1,
    marginTop: 30,
    width: "100%",
    appearance: "none",
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 14,
    padding: "13px 18px",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#FAFAF9",
    background: "rgba(255,255,255,0.06)",
    transition: "background 0.25s ease, transform 0.2s ease",
  },
  ctaRec: {
    position: "relative",
    zIndex: 1,
    marginTop: 30,
    width: "100%",
    appearance: "none",
    cursor: "pointer",
    border: "none",
    borderRadius: 14,
    padding: "14px 18px",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#02030A",
    background: "linear-gradient(120deg,#3FDCFF,#FF5BFC)",
    transition: "transform 0.2s ease, box-shadow 0.25s ease",
    boxShadow: "0 10px 30px rgba(255,91,252,0.30)",
  },
};

const CSS = `
@keyframes flow {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* Hover lift + realistic shadow + reflective sheen brighten (desktop pointers). */
@media (hover: hover) {
  .dvnt-pass { transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), z-index 0s; }
  .dvnt-pass:hover { transform: translateY(-10px); z-index: 5; }
  .dvnt-pass:hover .dvnt-pass-surface {
    box-shadow: 0 38px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06);
  }
  .dvnt-pass:hover .dvnt-pass-sheen { opacity: 1; }
  .dvnt-pass-cta:hover { background: rgba(255,255,255,0.12); }
  .dvnt-pass-cta--rec:hover { transform: translateY(-1px); box-shadow: 0 16px 40px rgba(255,91,252,0.42); }
}

.dvnt-pass-surface { transition: box-shadow 0.35s ease; }

/* Reduced motion: no flowing border, no entrance offset — clean static deck. */
@media (prefers-reduced-motion: reduce) {
  .dvnt-pass-border { animation: none; }
  .dvnt-pass { transform: none !important; opacity: 1 !important; }
}

/* Mobile: stack vertically as a clean column; reset the splay transforms. */
@media (max-width: 760px) {
  .dvnt-pass-deck { flex-direction: column; align-items: center; gap: 22px; }
  .dvnt-pass {
    margin: 0 !important;
    transform: none !important;
    width: 100%;
    max-width: 420px;
  }
}
`;
