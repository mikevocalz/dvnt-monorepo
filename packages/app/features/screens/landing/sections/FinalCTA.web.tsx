/**
 * Final pre-footer CTA — WEB. The end of the launch film: scattered app cards
 * drift in and settle into a clean composition behind the closing headline,
 * which rises word-by-word. Reduced-motion → static resolved layout.
 * Native fallback: FinalCTA.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

const LINES = ["Find your scene.", "Bring your people.", "Experience life together."];

export function FinalCTA() {
  const ref = useGsapScope((self) => {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: self, start: "top 72%" },
    });
    tl.from(
      self.querySelectorAll(".dvnt-fc-word"),
      { yPercent: 120, opacity: 0, filter: "blur(10px)", stagger: 0.09, duration: 0.75, ease: "power3.out" },
      0,
    );
    tl.from(
      self.querySelectorAll(".dvnt-fc-cta"),
      { y: 22, opacity: 0, duration: 0.6, ease: "power2.out" },
      0.5,
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.vars.trigger === self && t.kill());
    };
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="Find your scene"
      className="dvnt-fc-section"
      style={styles.section}
    >
      <style>{CSS}</style>
      <div style={styles.stage}>
        <div style={styles.copy}>
          <h2 style={styles.head}>
            {LINES.map((line) => (
              <span key={line} style={styles.lineWrap}>
                <span className="dvnt-fc-word" style={styles.word}>{line}</span>
              </span>
            ))}
          </h2>
          <div style={styles.ctaRow}>
            <a href="/auth/signup" className="dvnt-fc-cta" style={styles.primary}>Download DVNT</a>
          </div>
        </div>
      </div>
    </section>
  );
}

const CSS = `
@media (prefers-reduced-motion: reduce) { .dvnt-fc-card, .dvnt-fc-word, .dvnt-fc-cta { transition:none !important; } }
@media (max-width: 760px) {
  .dvnt-fc-section { padding-top: 84px !important; padding-bottom: 96px !important; }
}`;

const styles: Record<string, React.CSSProperties> = {
  section: { position: "relative", paddingTop: 140, paddingBottom: 150, paddingLeft: 24, paddingRight: 24, overflow: "hidden" },
  stage: { position: "relative", maxWidth: 900, margin: "0 auto", minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center" },
  card: {
    position: "absolute",
    width: 120,
    height: 150,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "solid",
    background: "linear-gradient(180deg, rgba(20,22,34,0.92), rgba(8,10,18,0.95))",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    overflow: "hidden",
    display: "flex",
    alignItems: "flex-end",
    padding: 12,
    willChange: "transform, opacity",
  },
  cardGlow: { position: "absolute", inset: 0 },
  cardLabel: { position: "relative", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#FAFAF9" },
  copy: { position: "relative", zIndex: 5, textAlign: "center" },
  head: { margin: 0, display: "flex", flexDirection: "column", gap: 2 },
  lineWrap: { display: "inline-flex", overflow: "hidden", justifyContent: "center", paddingBottom: "0.06em" },
  word: {
    display: "inline-block",
    fontWeight: 800,
    fontSize: "clamp(32px, 6vw, 68px)",
    lineHeight: 1.05,
    letterSpacing: -2,
    color: "#FAFAF9",
    willChange: "transform, filter, opacity",
  },
  ctaRow: { display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 34 },
  primary: {
    backgroundImage: "linear-gradient(135deg,#8A40CF,#FF5BFC)",
    color: "#0A0118",
    fontWeight: 800,
    fontSize: 16,
    padding: "15px 30px",
    borderRadius: 14,
    textDecoration: "none",
  },
  ghost: {
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#FAFAF9",
    fontWeight: 700,
    fontSize: 16,
    padding: "15px 30px",
    borderRadius: 14,
    textDecoration: "none",
  },
};
