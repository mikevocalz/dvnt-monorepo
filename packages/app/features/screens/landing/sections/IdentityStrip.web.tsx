/**
 * Identity strip — WEB. The first beat after the hero.
 *
 * Kinetic split-word headline that rises out of a mask with blur removal on a
 * ScrollTrigger, framed by social/event badges that drift at different rates
 * (scrubbed parallax). Reduced-motion users get the resolved static layout.
 * Native fallback: IdentityStrip.tsx.
 */
import { useGsapScope } from "../hooks/useGsap";

const HEAD = ["Your", "scene.", "Your", "people.", "Your", "night."];
const BADGES = [
  { label: "Stories", x: "6%", y: "14%", depth: 70, accent: "#3FDCFF" },
  { label: "Video Chat", x: "84%", y: "10%", depth: 120, accent: "#FF5BFC" },
  { label: "Tickets", x: "16%", y: "74%", depth: 90, accent: "#8A40CF" },
  { label: "Sneaky Link", x: "78%", y: "70%", depth: 150, accent: "#FF5BFC" },
  { label: "Events", x: "2%", y: "44%", depth: 50, accent: "#3FDCFF" },
  { label: "Posts", x: "90%", y: "42%", depth: 60, accent: "#8A40CF" },
  { label: "Apple Pay", x: "30%", y: "8%", depth: 110, accent: "#FAFAF9" },
  { label: "QR Entry", x: "66%", y: "86%", depth: 80, accent: "#3FDCFF" },
];

export function IdentityStrip() {
  const ref = useGsapScope((self, gsap) => {
    gsap.from(self.querySelectorAll(".dvnt-id-word"), {
      yPercent: 120,
      opacity: 0,
      filter: "blur(14px)",
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.07,
      scrollTrigger: { trigger: self, start: "top 72%" },
    });
    gsap.from(self.querySelectorAll(".dvnt-id-line"), {
      opacity: 0,
      y: 18,
      duration: 0.8,
      ease: "power2.out",
      stagger: 0.12,
      scrollTrigger: { trigger: self, start: "top 64%" },
    });
    // Badges: scrubbed parallax — deeper badges travel further.
    self.querySelectorAll<HTMLElement>(".dvnt-id-badge").forEach((b) => {
      const depth = Number(b.dataset.depth || 60);
      gsap.fromTo(
        b,
        { y: depth * 0.6, opacity: 0 },
        {
          y: -depth,
          opacity: 1,
          ease: "none",
          scrollTrigger: {
            trigger: self,
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
          },
        },
      );
    });
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="Real people. Real connections."
      className="dvnt-id-section"
      style={styles.section}
    >
      <style>{CSS}</style>
      {BADGES.map((b) => (
        <span
          key={b.label}
          className="dvnt-id-badge"
          data-depth={b.depth}
          style={{
            ...styles.badge,
            left: b.x,
            top: b.y,
            borderColor: `${b.accent}55`,
            color: b.accent,
          }}
        >
          {b.label}
        </span>
      ))}

      <div style={styles.inner}>
        <span className="dvnt-id-line" style={styles.eyebrow}>
          Real people. Real connections.
        </span>
        <h2 style={styles.head} className="dvnt-id-head">
          {HEAD.map((w, i) => (
            <span key={i} style={styles.wordMask}>
              <span className="dvnt-id-word" style={styles.word}>
                {w}
                {i < HEAD.length - 1 ? " " : ""}
              </span>
            </span>
          ))}
        </h2>
        <p className="dvnt-id-line" style={styles.sub}>
          Events, stories, posts, tickets, and live video — all in one social app.
        </p>
      </div>
    </section>
  );
}

const CSS = `
/* On phones the scattered badges are positioned at 84–90% with nowrap text, so
   they crowd the centered headline and get clipped. They're purely decorative
   (pointer-events:none) — hide them and tighten the vertical rhythm. */
@media (max-width: 760px) {
  .dvnt-id-badge { display: none !important; }
  .dvnt-id-section { padding-top: 72px !important; padding-bottom: 72px !important; }
}`;

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    overflow: "hidden",
    paddingTop: 130,
    paddingBottom: 130,
    paddingLeft: 24,
    paddingRight: 24,
    background: "transparent",
  },
  inner: {
    position: "relative",
    zIndex: 2,
    maxWidth: 980,
    margin: "0 auto",
    textAlign: "center",
  },
  eyebrow: {
    display: "inline-block",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 4,
    textTransform: "uppercase",
    color: "#FF5BFC",
    marginBottom: 22,
  },
  head: {
    margin: 0,
    fontWeight: 800,
    fontSize: "clamp(36px, 6vw, 72px)",
    lineHeight: 1.04,
    letterSpacing: -2,
    color: "#FAFAF9",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  wordMask: { display: "inline-flex", overflow: "hidden", paddingBottom: "0.08em" },
  word: { display: "inline-block", willChange: "transform, filter, opacity" },
  sub: {
    margin: "26px auto 0",
    maxWidth: 620,
    fontSize: 19,
    lineHeight: 1.5,
    color: "rgba(231,229,228,0.72)",
  },
  badge: {
    position: "absolute",
    zIndex: 1,
    padding: "8px 16px",
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    background: "rgba(8,10,20,0.55)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
};
