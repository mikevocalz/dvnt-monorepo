/**
 * Sneaky Link showcase — WEB. A pinned, scrubbed GSAP timeline tells the story
 * in labelled phases:
 *   "scatter" → anonymous blurred video tiles float in a loose cloud
 *   "gather"  → tiles snap into a tidy group-call grid
 *   "host"    → a host control panel slides in from the right; toggles animate on
 * Tiers (Free / Core / Pro) sit beneath. Reduced-motion → static resolved
 * layout. Native fallback: SneakyLinkShowcase.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

const TILES = [
  { x: "8%", y: "12%", s: 0.8, hue: "#3FDCFF" },
  { x: "70%", y: "8%", s: 1, hue: "#FF5BFC" },
  { x: "30%", y: "60%", s: 0.9, hue: "#8A40CF" },
  { x: "82%", y: "54%", s: 0.75, hue: "#3FDCFF" },
  { x: "52%", y: "30%", s: 1.05, hue: "#FF5BFC" },
  { x: "14%", y: "70%", s: 0.85, hue: "#8A40CF" },
];
// Final tidy 3×2 grid slots (% of the stage) the tiles snap into.
const GRID = [
  { x: "20%", y: "26%" },
  { x: "50%", y: "26%" },
  { x: "80%", y: "26%" },
  { x: "20%", y: "64%" },
  { x: "50%", y: "64%" },
  { x: "80%", y: "64%" },
];
const TIERS = [
  { name: "Free", lines: ["5-minute sessions", "Up to 5 people per link"], accent: "#3FDCFF" },
  { name: "Core", lines: ["Unlimited sessions", "Up to 10 people per link"], accent: "#FF5BFC", featured: true },
  { name: "Pro", lines: ["Unlimited sessions", "Up to 50 people per link"], accent: "#8A40CF" },
];
const TOGGLES = ["Face required", "Chat muted", "Blocked accounts", "Room limit"];

export function SneakyLinkShowcase() {
  const ref = useGsapScope((self) => {
    const stage = self.querySelector<HTMLElement>(".dvnt-sl-stage");
    const tiles = gsap.utils.toArray<HTMLElement>(".dvnt-sl-tile", self);
    const panel = self.querySelector<HTMLElement>(".dvnt-sl-host");
    const knobs = gsap.utils.toArray<HTMLElement>(".dvnt-sl-knob", self);

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: stage,
        start: "top 70%",
        end: "+=120%",
        scrub: 1,
        pin: stage,
        pinSpacing: true,
      },
    });

    tl.addLabel("scatter");
    // gather: each tile eases from its scattered spot into its grid slot
    tiles.forEach((tile, i) => {
      const slot = GRID[i];
      tl.to(
        tile,
        {
          left: slot.x,
          top: slot.y,
          scale: 1,
          filter: "blur(3px)",
          ease: "power2.inOut",
        },
        "gather",
      );
    });
    tl.addLabel("gather");
    tl.from(panel, { xPercent: 120, opacity: 0, ease: "power3.out" }, "host");
    tl.to(knobs, { x: 18, backgroundColor: "#22c55e", stagger: 0.08, ease: "back.out(2)" }, "host+=0.1");
    tl.addLabel("host");

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.vars.trigger === stage && t.kill());
    };
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="Sneaky Link"
      style={styles.section}
    >
      <style>{CSS}</style>
      <div style={styles.head}>
        <span style={styles.kicker}>Sneaky Link</span>
        <h2 style={styles.h2}>
          Anonymous video calling for the people you actually want in the room.
        </h2>
      </div>

      <div className="dvnt-sl-stage" style={styles.stage}>
        {TILES.map((t, i) => (
          <div
            key={i}
            className="dvnt-sl-tile"
            style={{
              ...styles.tile,
              left: t.x,
              top: t.y,
              transform: `scale(${t.s})`,
              boxShadow: `0 16px 50px ${t.hue}44`,
            }}
          >
            <span className="dvnt-sl-sil" style={{ background: `radial-gradient(circle at 50% 40%, ${t.hue}55, transparent 70%)` }} />
            <span style={styles.tileDot} />
          </div>
        ))}

        <aside className="dvnt-sl-host" style={styles.host}>
          <span style={styles.hostTitle}>Host controls</span>
          {TOGGLES.map((t) => (
            <div key={t} style={styles.hostRow}>
              <span style={styles.hostLabel}>{t}</span>
              <span style={styles.track}>
                <span className="dvnt-sl-knob" style={styles.knob} />
              </span>
            </div>
          ))}
          <p style={styles.hostNote}>Control the room before anyone enters.</p>
        </aside>
      </div>

      <div style={styles.tiers}>
        {TIERS.map((t) => (
          <div
            key={t.name}
            style={{
              ...styles.tier,
              borderColor: t.featured ? t.accent : "rgba(255,255,255,0.1)",
              boxShadow: t.featured ? `0 0 0 1px ${t.accent}, 0 24px 60px ${t.accent}33` : undefined,
            }}
          >
            <span style={{ ...styles.tierName, color: t.accent }}>{t.name}</span>
            {t.lines.map((l) => (
              <span key={l} style={styles.tierLine}>{l}</span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const CSS = `
.dvnt-sl-sil { position:absolute; inset:0; border-radius:18px; filter: blur(6px); }
@media (prefers-reduced-motion: reduce) { .dvnt-sl-tile, .dvnt-sl-host, .dvnt-sl-knob { transition:none !important; } }`;

const styles: Record<string, React.CSSProperties> = {
  section: { position: "relative", paddingTop: 90, paddingBottom: 110, paddingLeft: 24, paddingRight: 24 },
  head: { maxWidth: 820, margin: "0 auto 40px", textAlign: "center" },
  kicker: {
    fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 4,
    textTransform: "uppercase", color: "#FF5BFC",
  },
  h2: { margin: "14px 0 0", fontWeight: 800, fontSize: "clamp(26px,4vw,46px)", lineHeight: 1.12, letterSpacing: -1, color: "#FAFAF9" },
  stage: {
    position: "relative",
    maxWidth: 1000,
    height: 460,
    margin: "0 auto",
    borderRadius: 28,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "radial-gradient(120% 120% at 50% 0%, rgba(138,64,207,0.16), rgba(2,3,10,0.6))",
    overflow: "hidden",
  },
  tile: {
    position: "absolute",
    width: 130,
    height: 150,
    marginLeft: -65,
    marginTop: -75,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(10,12,22,0.7)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    overflow: "hidden",
    willChange: "left, top, transform",
  },
  tileDot: {
    position: "absolute", bottom: 10, left: 10, width: 8, height: 8, borderRadius: "50%",
    background: "#22c55e", boxShadow: "0 0 8px #22c55e",
  },
  host: {
    position: "absolute",
    top: 24,
    right: 24,
    width: 260,
    padding: 18,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(8,10,18,0.86)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    zIndex: 5,
  },
  hostTitle: { display: "block", fontFamily: "monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginBottom: 14 },
  hostRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  hostLabel: { fontSize: 13, color: "#FAFAF9", fontWeight: 600 },
  track: { width: 40, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.14)", position: "relative", display: "inline-block" },
  knob: { position: "absolute", top: 2, left: 2, width: 18, height: 18, borderRadius: "50%", background: "#fff" },
  hostNote: { marginTop: 8, marginBottom: 0, fontSize: 12, color: "rgba(231,229,228,0.55)", lineHeight: 1.4 },
  tiers: { maxWidth: 900, margin: "44px auto 0", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" },
  tier: {
    flex: "1 1 220px",
    maxWidth: 280,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "solid",
    padding: "22px 20px",
    background: "linear-gradient(180deg, rgba(18,20,30,0.8), rgba(8,10,18,0.9))",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  tierName: { fontFamily: "monospace", fontSize: 14, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" },
  tierLine: { fontSize: 14, color: "rgba(231,229,228,0.72)" },
};
