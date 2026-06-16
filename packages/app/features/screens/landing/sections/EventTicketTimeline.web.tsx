/**
 * Event ticket timeline — WEB. A pinned horizontal-scroll event timeline.
 *
 * Motion:
 *  - The section pins and a wide `.dvnt-evt-track` translates on scrub as the
 *    user scrolls the window vertically (proven pin + scrub pattern).
 *  - Cards fade/scale in with a stagger driven off the same timeline
 *    (containerAnimation) so they animate as they enter the viewport.
 *  - One card carries a ticket-stub → QR 3D flip (CSS rotateY, preserve-3d).
 *
 * Reduced-motion → static horizontal layout (the useGsapScope guard skips all
 * gsap; CSS animations disabled via the media query in CSS below).
 * Native fallback: EventTicketTimeline.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

interface EventCard {
  key: string;
  name: string;
  date: string;
  venue: string;
  accent: string;
  status: string;
  statusTone: "live" | "soon" | "low";
  cta: string;
  flip?: boolean;
}

const EVENTS: EventCard[] = [
  {
    key: "synthesis",
    name: "SYNTHESIS: Open Rave",
    date: "FRI · JUN 27 · 10PM",
    venue: "The Foundry — Bushwick",
    accent: "#3FDCFF",
    status: "Tickets Live",
    statusTone: "live",
    cta: "Buy Ticket",
    flip: true,
  },
  {
    key: "vinyl",
    name: "Vinyl Lounge",
    date: "SAT · JUL 05 · 9PM",
    venue: "Sublabel — LES",
    accent: "#FF5BFC",
    status: "Drops Jul 1",
    statusTone: "soon",
    cta: "Notify Me",
  },
  {
    key: "afters",
    name: "Underground Afters",
    date: "SUN · JUL 06 · 4AM",
    venue: "Location on RSVP",
    accent: "#8A40CF",
    status: "Few Left",
    statusTone: "low",
    cta: "Buy Ticket",
  },
  {
    key: "warehouse9",
    name: "Warehouse 9",
    date: "FRI · JUL 11 · 11PM",
    venue: "Pier 9 — Red Hook",
    accent: "#3FDCFF",
    status: "Tickets Live",
    statusTone: "live",
    cta: "Buy Ticket",
  },
  {
    key: "rooftop",
    name: "Rooftop Reset",
    date: "SAT · JUL 19 · 6PM",
    venue: "Skyline 47 — Williamsburg",
    accent: "#FF5BFC",
    status: "Drops Jul 14",
    statusTone: "soon",
    cta: "Notify Me",
  },
];

const TONE: Record<EventCard["statusTone"], { fg: string; bg: string; bd: string }> = {
  live: { fg: "#3FDCFF", bg: "rgba(63,220,255,0.12)", bd: "rgba(63,220,255,0.40)" },
  soon: { fg: "#FF5BFC", bg: "rgba(255,91,252,0.12)", bd: "rgba(255,91,252,0.40)" },
  low: { fg: "#FFC75B", bg: "rgba(255,199,91,0.12)", bd: "rgba(255,199,91,0.42)" },
};

export function EventTicketTimeline() {
  const ref = useGsapScope((self) => {
    const track = self.querySelector<HTMLElement>(".dvnt-evt-track");
    if (!track) return;
    const cards = gsap.utils.toArray<HTMLElement>(".dvnt-evt-card", self);

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: self,
        start: "top top",
        end: () => "+=" + track.scrollWidth,
        scrub: 1,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
    tl.to(track, {
      x: () => -(track.scrollWidth - self.clientWidth),
      ease: "none",
    });

    // Per-card entrance + center-emphasis, sequenced along the same scrub
    // timeline (containerAnimation) so they react to the horizontal scroll.
    const cardTriggers: ScrollTrigger[] = [];
    cards.forEach((card) => {
      gsap.set(card, { opacity: 0.55, scale: 0.92 });
      const st = ScrollTrigger.create({
        trigger: card,
        containerAnimation: tl,
        start: "left 80%",
        end: "right 20%",
        onEnter: () =>
          gsap.to(card, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }),
        onLeave: () =>
          gsap.to(card, { opacity: 0.55, scale: 0.92, duration: 0.5, ease: "power2.out" }),
        onEnterBack: () =>
          gsap.to(card, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }),
        onLeaveBack: () =>
          gsap.to(card, { opacity: 0.55, scale: 0.92, duration: 0.5, ease: "power2.out" }),
      });
      cardTriggers.push(st);
    });

    return () => {
      cardTriggers.forEach((t) => t.kill());
      tl.scrollTrigger?.kill();
      tl.kill();
    };
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      style={styles.section}
      aria-label="Events & Tickets"
    >
      <style>{CSS}</style>
      <div style={styles.glow} aria-hidden />

      <div style={styles.inner}>
        <header style={styles.header}>
          <span style={styles.kicker}>Events &amp; Tickets</span>
          <h2 style={styles.headline}>
            DVNT is the ticketing app for the people who actually go out.
          </h2>
          <p style={styles.sub}>
            Find events that match your scene. Get notified the moment tickets drop. Buy in
            seconds. Show up, scan in, post the night.
          </p>
        </header>

        <div className="dvnt-evt-viewport" style={styles.viewport}>
          <div className="dvnt-evt-track" style={styles.track}>
            {EVENTS.map((ev) => (
              <article key={ev.key} className="dvnt-evt-card" style={styles.card}>
                {/* Flyer / image area */}
                <div
                  style={{
                    ...styles.flyer,
                    backgroundImage: flyerGradient(ev.accent),
                  }}
                >
                  <span style={styles.flyerName}>{ev.name}</span>
                  <span style={{ ...styles.qrBadge }} aria-hidden />
                </div>

                {/* Meta */}
                <div style={styles.meta}>
                  <span style={{ ...styles.date, color: ev.accent }}>{ev.date}</span>
                  <span style={styles.venue}>{ev.venue}</span>
                </div>

                {/* RSVP avatars + status pill */}
                <div style={styles.rsvpRow}>
                  <div style={styles.avatars} aria-label="People going">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        style={{
                          ...styles.avatar,
                          marginLeft: i === 0 ? 0 : -10,
                          backgroundImage: avatarGradient(ev.accent, i),
                        }}
                      />
                    ))}
                    <span style={styles.rsvpCount}>+128 going</span>
                  </div>
                  <span
                    style={{
                      ...styles.statusPill,
                      color: TONE[ev.statusTone].fg,
                      background: TONE[ev.statusTone].bg,
                      borderColor: TONE[ev.statusTone].bd,
                    }}
                  >
                    {ev.status}
                  </span>
                </div>

                {/* Ticket stub: flips into a QR on the featured card */}
                {ev.flip ? (
                  <div className="dvnt-evt-flip" style={styles.flipWrap}>
                    <div className="dvnt-evt-flip-inner" style={styles.flipInner}>
                      <div style={{ ...styles.flipFace, ...styles.flipFront }}>
                        <span style={styles.stubLabel}>ADMIT ONE</span>
                        <span style={styles.stubHint}>hover to reveal QR</span>
                      </div>
                      <div style={{ ...styles.flipFace, ...styles.flipBack }}>
                        <span style={styles.flipQr} aria-hidden />
                        <span style={styles.stubLabel}>SCAN IN</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={styles.stubStatic}>
                    <span style={styles.stubLabel}>TICKET STUB</span>
                    <span style={styles.stubPerf} aria-hidden />
                  </div>
                )}

                {/* CTA */}
                <button
                  type="button"
                  className="dvnt-evt-cta"
                  style={{
                    ...styles.cta,
                    backgroundImage:
                      ev.cta === "Buy Ticket"
                        ? `linear-gradient(135deg, ${ev.accent}, #FF5BFC)`
                        : "none",
                    background:
                      ev.cta === "Buy Ticket" ? undefined : "rgba(255,255,255,0.04)",
                    color: ev.cta === "Buy Ticket" ? "#02030A" : "#FAFAF9",
                    borderColor:
                      ev.cta === "Buy Ticket" ? "transparent" : "rgba(255,255,255,0.18)",
                  }}
                >
                  {ev.cta}
                </button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function flyerGradient(accent: string): string {
  return `radial-gradient(120% 120% at 0% 0%, ${accent}55 0%, rgba(2,3,10,0) 55%), linear-gradient(160deg, rgba(138,64,207,0.55), rgba(2,3,10,0.9))`;
}
function avatarGradient(accent: string, i: number): string {
  const tints = [accent, "#FF5BFC", "#8A40CF", "#7C3AED"];
  return `linear-gradient(135deg, ${tints[i % tints.length]}, rgba(2,3,10,0.85))`;
}

const QR_TILE = "repeating-conic-gradient(#fff 0 25%, #0b0c14 0 50%) 0 0 / 12px 12px";

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    background: "transparent",
    color: "#FAFAF9",
    overflow: "hidden",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
  },
  glow: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(60% 50% at 20% 30%, rgba(63,220,255,0.10) 0%, rgba(2,3,10,0) 60%), radial-gradient(50% 50% at 85% 70%, rgba(255,91,252,0.12) 0%, rgba(2,3,10,0) 60%)",
    pointerEvents: "none",
  },
  inner: {
    position: "relative",
    width: "100%",
    maxWidth: 1400,
    margin: "0 auto",
    padding: "72px 28px",
    boxSizing: "border-box",
  },
  header: { maxWidth: 720, marginBottom: 44 },
  kicker: {
    display: "inline-block",
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: "0.28em",
    fontSize: 12,
    color: "#3FDCFF",
    marginBottom: 18,
  },
  headline: {
    fontFamily: '"Republica-Minor", system-ui, sans-serif',
    fontSize: "clamp(28px, 4vw, 46px)",
    lineHeight: 1.08,
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  sub: {
    marginTop: 18,
    fontSize: "clamp(15px, 1.6vw, 18px)",
    lineHeight: 1.6,
    color: "rgba(231,229,228,0.66)",
    maxWidth: 620,
  },
  viewport: { width: "100%", overflow: "hidden" },
  track: {
    display: "flex",
    gap: 24,
    width: "max-content",
    paddingBottom: 8,
    willChange: "transform",
  },
  card: {
    flex: "0 0 auto",
    width: 320,
    borderRadius: 20,
    padding: 18,
    boxSizing: "border-box",
    background:
      "linear-gradient(180deg, rgba(18,20,30,0.9), rgba(8,10,18,0.92))",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    willChange: "transform, opacity",
  },
  flyer: {
    position: "relative",
    height: 168,
    borderRadius: 14,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "flex-end",
    padding: 14,
  },
  flyerName: {
    fontFamily: '"Republica-Minor", system-ui, sans-serif',
    fontSize: 19,
    fontWeight: 700,
    lineHeight: 1.1,
    maxWidth: "75%",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
  },
  qrBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 8,
    background: QR_TILE,
    border: "2px solid rgba(255,255,255,0.7)",
    boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
  },
  meta: { display: "flex", flexDirection: "column", gap: 4 },
  date: {
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: "0.12em",
    fontWeight: 600,
  },
  venue: { fontSize: 14, color: "rgba(231,229,228,0.66)" },
  rsvpRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  avatars: { display: "flex", alignItems: "center" },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    border: "2px solid #0b0c14",
    display: "inline-block",
  },
  rsvpCount: {
    marginLeft: 10,
    fontSize: 12,
    color: "rgba(231,229,228,0.66)",
    whiteSpace: "nowrap",
  },
  statusPill: {
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: "0.06em",
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid",
    whiteSpace: "nowrap",
  },
  flipWrap: {
    perspective: "800px",
    height: 64,
  },
  flipInner: {
    position: "relative",
    width: "100%",
    height: "100%",
    transformStyle: "preserve-3d",
    transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)",
  },
  flipFace: {
    position: "absolute",
    inset: 0,
    borderRadius: 12,
    border: "1px dashed rgba(255,255,255,0.20)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  },
  flipFront: {
    background: "rgba(255,255,255,0.04)",
    flexDirection: "column",
    gap: 2,
  },
  flipBack: {
    background: "rgba(2,3,10,0.7)",
    transform: "rotateY(180deg)",
  },
  flipQr: {
    width: 40,
    height: 40,
    borderRadius: 6,
    background: QR_TILE,
    border: "2px solid rgba(255,255,255,0.7)",
  },
  stubStatic: {
    height: 64,
    borderRadius: 12,
    border: "1px dashed rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.03)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
  },
  stubLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: "0.18em",
    color: "rgba(231,229,228,0.66)",
  },
  stubHint: {
    fontSize: 10,
    color: "rgba(231,229,228,0.45)",
  },
  stubPerf: {
    width: 60,
    height: 2,
    backgroundImage:
      "repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 4px, transparent 4px 9px)",
  },
  cta: {
    marginTop: "auto",
    height: 46,
    borderRadius: 12,
    border: "1px solid",
    fontFamily: '"Republica-Minor", system-ui, sans-serif',
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    transition: "transform 0.18s ease, box-shadow 0.18s ease",
  },
};

const CSS = `
.dvnt-evt-card:hover .dvnt-evt-flip-inner { transform: rotateY(180deg); }
.dvnt-evt-cta:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,0.45); }
.dvnt-evt-cta:active { transform: translateY(0); }
.dvnt-evt-card { transition: border-color 0.25s ease, box-shadow 0.25s ease; }
.dvnt-evt-card:hover { border-color: rgba(255,255,255,0.22); box-shadow: 0 26px 60px rgba(0,0,0,0.45); }
@media (prefers-reduced-motion: reduce) {
  .dvnt-evt-viewport { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .dvnt-evt-flip-inner { transition: none; }
  .dvnt-evt-card:hover .dvnt-evt-flip-inner { transform: none; }
  .dvnt-evt-cta { transition: none; }
  .dvnt-evt-cta:hover { transform: none; box-shadow: none; }
  .dvnt-evt-card { opacity: 1 !important; transform: none !important; }
}
`;
