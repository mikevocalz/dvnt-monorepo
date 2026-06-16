/**
 * Bento feature grid — WEB. Eight feature cards in an asymmetric bento layout.
 *
 * Motion:
 *  - staggered scroll-linked reveal (scale + blur + rise) via ScrollTrigger.batch
 *  - magnetic hover with 3D tilt + a cursor-tracked light reflection (desktop)
 *  - tactile press depth (pointerdown) for touch
 *  - per-card CSS micro-animations (scanning shimmer, story rings, video
 *    bubbles, pulsing RSVP avatars, cycling payment labels, host toggles)
 *
 * Reduced-motion → static grid (the useGsapScope guard skips all of it; CSS
 * micro-animations are disabled via the media query in CSS below).
 * Native fallback: BentoFeatureGrid.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

type Kind =
  | "events"
  | "payments"
  | "rsvp"
  | "stories"
  | "video"
  | "host"
  | "qr"
  | "membership";

interface Card {
  key: string;
  title: string;
  body: string;
  kind: Kind;
  accent: string;
  area: string; // grid-area for desktop layout
}

const CARDS: Card[] = [
  { key: "a", title: "Find Your Scene", body: "Discover events that match your vibe, your city, and your people.", kind: "events", accent: "#3FDCFF", area: "a" },
  { key: "b", title: "Buy Tickets Fast", body: "Apple Pay, Cash App Pay, Klarna, Afterpay, Affirm, or card.", kind: "payments", accent: "#FF5BFC", area: "b" },
  { key: "c", title: "See Who's Going", body: "Know the energy before you commit.", kind: "rsvp", accent: "#8A40CF", area: "c" },
  { key: "d", title: "Post the Night", body: "Share photos, stories, and moments while the room is still moving.", kind: "stories", accent: "#FF5BFC", area: "d" },
  { key: "e", title: "Sneaky Link", body: "Anonymous video calling built for quick, private, real-time connection.", kind: "video", accent: "#3FDCFF", area: "e" },
  { key: "f", title: "Host Tools", body: "Block accounts, require face for access, mute chat, control the link you host.", kind: "host", accent: "#8A40CF", area: "f" },
  { key: "g", title: "QR Entry", body: "Show up, scan in, and keep the line moving.", kind: "qr", accent: "#3FDCFF", area: "g" },
  { key: "h", title: "Membership", body: "Unlock the best of the app and events.", kind: "membership", accent: "#FF5BFC", area: "h" },
];

export function BentoFeatureGrid() {
  const ref = useGsapScope((self) => {
    const cards = gsap.utils.toArray<HTMLElement>(".dvnt-bento-card", self);

    // Staggered, scroll-linked reveal (ScrollTrigger.batch — registered by the hook).
    gsap.set(cards, { opacity: 0, y: 44, scale: 0.94, filter: "blur(10px)" });
    ScrollTrigger.batch(cards, {
      start: "top 85%",
      onEnter: (batch: Element[]) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.85,
          ease: "power3.out",
          stagger: 0.09,
          overwrite: true,
        }),
    });

    // Magnetic tilt + light reflection (desktop pointers only).
    const fine =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(pointer: fine)").matches;
    const detach: Array<() => void> = [];
    cards.forEach((card) => {
      const inner = card.querySelector<HTMLElement>(".dvnt-bento-inner");
      if (!inner) return;
      const xTo = gsap.quickTo(inner, "rotationY", { duration: 0.5, ease: "power3" });
      const yTo = gsap.quickTo(inner, "rotationX", { duration: 0.5, ease: "power3" });
      const mxTo = gsap.quickTo(card, "--mx", { duration: 0.4, ease: "power2" });
      const myTo = gsap.quickTo(card, "--my", { duration: 0.4, ease: "power2" });

      const onMove = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        if (fine) {
          xTo((px - 0.5) * 14);
          yTo(-(py - 0.5) * 14);
        }
        mxTo(`${px * 100}%` as unknown as number);
        myTo(`${py * 100}%` as unknown as number);
      };
      const onLeave = () => {
        xTo(0);
        yTo(0);
        gsap.to(inner, { scale: 1, duration: 0.4, ease: "power2" });
      };
      const onDown = () => gsap.to(inner, { scale: 0.97, duration: 0.18, ease: "power2" });
      const onUp = () => gsap.to(inner, { scale: 1, duration: 0.3, ease: "back.out(2)" });

      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerleave", onLeave);
      card.addEventListener("pointerdown", onDown);
      card.addEventListener("pointerup", onUp);
      detach.push(() => {
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerleave", onLeave);
        card.removeEventListener("pointerdown", onDown);
        card.removeEventListener("pointerup", onUp);
      });
    });

    return () => detach.forEach((d) => d());
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="Features"
      style={styles.section}
    >
      <style>{CSS}</style>
      <div style={styles.head}>
        <span style={styles.kicker}>One social app</span>
        <h2 style={styles.h2}>Everything the night needs, in one place.</h2>
      </div>

      <div className="dvnt-bento-grid" style={styles.grid}>
        {CARDS.map((c) => (
          <article
            key={c.key}
            className="dvnt-bento-card"
            tabIndex={0}
            style={{ ...styles.card, gridArea: c.area, ["--accent" as string]: c.accent }}
          >
            <div className="dvnt-bento-inner" style={styles.inner}>
              <div className="dvnt-bento-sheen" />
              <CardVisual kind={c.kind} accent={c.accent} />
              <div style={styles.cardText}>
                <h3 style={styles.cardTitle}>{c.title}</h3>
                <p style={styles.cardBody}>{c.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Per-card micro-visual. Pure CSS animations (declared in CSS below). */
function CardVisual({ kind, accent }: { kind: Kind; accent: string }) {
  switch (kind) {
    case "stories":
      return (
        <div style={visual.row}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="dvnt-ring" style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
        </div>
      );
    case "rsvp":
    case "events":
      return (
        <div style={visual.row}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="dvnt-avatar"
              style={{ marginLeft: i ? -10 : 0, animationDelay: `${i * 0.25}s`, zIndex: 5 - i }}
            />
          ))}
          <span style={visual.rsvpCount}>+128 going</span>
        </div>
      );
    case "payments":
      return (
        <div className="dvnt-paywin" style={visual.payWin}>
          <ul className="dvnt-payloop" style={visual.payLoop}>
            {["Apple Pay", "Cash App Pay", "Klarna", "Afterpay", "Affirm", "Card", "Apple Pay"].map(
              (p, i) => (
                <li key={i} style={visual.payItem}>{p}</li>
              ),
            )}
          </ul>
        </div>
      );
    case "video":
      return (
        <div style={visual.bubbleWrap}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="dvnt-bubble" style={{ animationDelay: `${i * 0.7}s`, left: `${i * 26}px` }} />
          ))}
        </div>
      );
    case "host":
      return (
        <div style={visual.toggles}>
          {["Face required", "Chat muted", "Blocked"].map((t, i) => (
            <div key={t} style={visual.toggleRow}>
              <span style={visual.toggleLabel}>{t}</span>
              <span className="dvnt-toggle" style={{ animationDelay: `${0.6 + i * 0.5}s` }}>
                <span className="dvnt-knob" />
              </span>
            </div>
          ))}
        </div>
      );
    case "qr":
      return (
        <div className="dvnt-qr" style={visual.qr}>
          <span className="dvnt-scanline" style={{ background: accent }} />
        </div>
      );
    case "membership":
      return (
        <div style={visual.passWrap}>
          <span className="dvnt-pass" style={visual.pass}>MEMBER</span>
        </div>
      );
    default:
      return null;
  }
}

const CSS = `
.dvnt-bento-card { --mx: 50%; --my: 50%; perspective: 900px; outline: none; }
.dvnt-bento-card:focus-visible .dvnt-bento-inner { box-shadow: 0 0 0 2px var(--accent); }
.dvnt-bento-inner { transform-style: preserve-3d; will-change: transform; }
.dvnt-bento-sheen {
  position: absolute; inset: 0; border-radius: 22px; pointer-events: none; opacity: 0; transition: opacity .3s ease;
  background: radial-gradient(420px circle at var(--mx) var(--my), color-mix(in srgb, var(--accent) 24%, transparent), transparent 60%);
}
.dvnt-bento-card:hover .dvnt-bento-sheen { opacity: 1; }
.dvnt-bento-card:hover .dvnt-bento-inner { border-color: color-mix(in srgb, var(--accent) 45%, rgba(255,255,255,0.1)); }

.dvnt-ring { width: 34px; height: 34px; border-radius: 50%; padding: 2px;
  background: conic-gradient(from 0deg, #3FDCFF, #FF5BFC, #8A40CF, #3FDCFF); animation: dvntSpin 3.4s linear infinite; }
.dvnt-ring::after { content:""; display:block; width:100%; height:100%; border-radius:50%; background:#0b0c14; }
@keyframes dvntSpin { to { transform: rotate(360deg); } }

.dvnt-avatar { width: 30px; height: 30px; border-radius: 50%; border: 2px solid #0b0c14;
  background: linear-gradient(135deg,#8A40CF,#FF5BFC); animation: dvntPulse 1.8s ease-in-out infinite; }
@keyframes dvntPulse { 0%,100%{ transform: scale(1);} 50%{ transform: scale(1.12);} }

.dvnt-paywin { overflow: hidden; height: 30px; }
/* 6 unique labels + 1 duplicate of the first = seamless loop. The window is one
   item tall (30px); step through 6 items (6 × 30 = 180px), landing on the
   duplicate which equals the start. A short hold reads cleanly per label. */
.dvnt-payloop { margin:0; padding:0; list-style:none; animation: dvntPayScroll 9s steps(6) infinite; }
@keyframes dvntPayScroll { to { transform: translateY(-180px); } }

.dvnt-bubble { position:absolute; top:0; width: 34px; height: 34px; border-radius:50%;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(63,220,255,0.12));
  border:1px solid rgba(255,255,255,0.18); animation: dvntFloat 3s ease-in-out infinite; }
@keyframes dvntFloat { 0%,100%{ transform: translateY(0);} 50%{ transform: translateY(-10px);} }

.dvnt-toggle { width: 38px; height: 20px; border-radius: 999px; background: rgba(255,255,255,0.12);
  position: relative; animation: dvntToggleOn 4s ease-in-out infinite; }
.dvnt-knob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff;
  animation: dvntKnob 4s ease-in-out infinite; }
@keyframes dvntToggleOn { 0%,40%{ background: rgba(255,255,255,0.12);} 55%,100%{ background:#22c55e;} }
@keyframes dvntKnob { 0%,40%{ left:2px;} 55%,100%{ left:20px;} }

.dvnt-qr { position: relative; width: 56px; height: 56px; border-radius: 10px; overflow: hidden;
  background:
    repeating-conic-gradient(#fff 0% 25%, #0b0c14 0% 50%) 0 0 / 14px 14px; }
.dvnt-scanline { position:absolute; left:0; right:0; height: 3px; top:0; opacity:0.85;
  box-shadow: 0 0 10px currentColor; animation: dvntScan 2.2s ease-in-out infinite; }
@keyframes dvntScan { 0%,100%{ top: 2px;} 50%{ top: 50px;} }

.dvnt-pass { display:inline-block; padding: 8px 16px; border-radius: 10px; font-family: monospace; font-weight: 800;
  letter-spacing: 3px; font-size: 13px; color:#0A0118; background: linear-gradient(120deg,#FF5BFC,#8A40CF,#3FDCFF);
  background-size: 200% 200%; animation: dvntPassShift 4s ease infinite; }
@keyframes dvntPassShift { 0%,100%{ background-position: 0% 50%;} 50%{ background-position:100% 50%;} }

@media (prefers-reduced-motion: reduce) {
  .dvnt-ring,.dvnt-avatar,.dvnt-payloop,.dvnt-bubble,.dvnt-toggle,.dvnt-knob,.dvnt-scanline,.dvnt-pass { animation: none !important; }
}
@media (max-width: 760px) {
  .dvnt-bento-grid { grid-template-columns: 1fr 1fr !important; grid-template-areas:
    "a a" "b c" "d e" "f g" "h h" !important; }
}
@media (max-width: 480px) {
  /* Below ~480px the two-up cards get too narrow for their inner visuals
     (180px toggle rows, payment window) and clip. Stack to a single column. */
  .dvnt-bento-grid { grid-template-columns: 1fr !important; grid-template-areas:
    "a" "b" "c" "d" "e" "f" "g" "h" !important; }
}`;

const styles: Record<string, React.CSSProperties> = {
  section: { position: "relative", paddingTop: 100, paddingBottom: 110, paddingLeft: 24, paddingRight: 24 },
  head: { maxWidth: 1100, margin: "0 auto 44px", textAlign: "center" },
  kicker: {
    fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 3,
    textTransform: "uppercase", color: "#3FDCFF",
  },
  h2: {
    margin: "14px 0 0", fontWeight: 800, fontSize: "clamp(30px,4.6vw,52px)",
    letterSpacing: -1.5, lineHeight: 1.08, color: "#FAFAF9",
  },
  grid: {
    maxWidth: 1140,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gridAutoRows: "minmax(180px, auto)",
    gap: 18,
    gridTemplateAreas: `
      "a a b c"
      "d e e f"
      "g h h h"`,
  },
  card: { position: "relative", minHeight: 180 },
  inner: {
    position: "relative",
    height: "100%",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "linear-gradient(180deg, rgba(18,20,30,0.9), rgba(8,10,18,0.92))",
    padding: 22,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 18,
    overflow: "hidden",
    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
  },
  cardText: { position: "relative", zIndex: 2 },
  cardTitle: { margin: 0, fontSize: 19, fontWeight: 800, color: "#FAFAF9", letterSpacing: -0.4 },
  cardBody: { margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "rgba(231,229,228,0.66)" },
};

const visual: Record<string, React.CSSProperties> = {
  row: { display: "flex", alignItems: "center", gap: 0, position: "relative", zIndex: 2 },
  rsvpCount: { marginLeft: 12, fontFamily: "monospace", fontSize: 12, color: "rgba(255,255,255,0.7)" },
  payWin: { position: "relative", zIndex: 2, width: 150 },
  payLoop: {},
  payItem: {
    height: 30, lineHeight: "30px", fontFamily: "monospace", fontWeight: 700, fontSize: 14,
    color: "#FAFAF9",
  },
  bubbleWrap: { position: "relative", height: 44, width: 100, zIndex: 2 },
  toggles: { display: "flex", flexDirection: "column", gap: 8, zIndex: 2, position: "relative" },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", width: 180 },
  toggleLabel: { fontFamily: "monospace", fontSize: 12, color: "rgba(255,255,255,0.7)" },
  qr: { zIndex: 2 },
  passWrap: { zIndex: 2 },
  pass: {},
};
