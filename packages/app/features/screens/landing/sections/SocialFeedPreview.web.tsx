/**
 * Social Feed preview — WEB. A CSS phone mockup whose inner feed column
 * (`.dvnt-feed-track`) scrubs UP in sync with the page scroll, so the night's
 * stories/posts/comments scroll past inside the screen as the visitor moves
 * through the section. A few tasteful glass reaction chips drift in around the
 * phone on scroll. Reduced-motion → static resolved layout. Native fallback:
 * SocialFeedPreview.tsx.
 */
import { useGsapScope, gsap, ScrollTrigger } from "../hooks/useGsap";

const STORIES = [
  { name: "rave", ring: "linear-gradient(135deg,#3FDCFF,#8A40CF)" },
  { name: "kiko", ring: "linear-gradient(135deg,#FF5BFC,#8A40CF)" },
  { name: "mia", ring: "linear-gradient(135deg,#3FDCFF,#FF5BFC)" },
  { name: "dev", ring: "linear-gradient(135deg,#8A40CF,#3FDCFF)" },
  { name: "lux", ring: "linear-gradient(135deg,#FF5BFC,#3FDCFF)" },
];

const POSTS = [
  {
    name: "nyla.exe",
    handle: "@nyla",
    avatar: "linear-gradient(135deg,#3FDCFF,#8A40CF)",
    text: "front row energy. the drop hit different tonight 🔊",
    image: "linear-gradient(135deg,#8A40CF 0%,#FF5BFC 60%,#3FDCFF 100%)",
  },
  {
    name: "deon",
    handle: "@deon",
    avatar: "linear-gradient(135deg,#FF5BFC,#8A40CF)",
    text: "who else is still on the rooftop ☁️",
    image: "linear-gradient(160deg,#02030A 0%,#8A40CF 70%,#FF5BFC 100%)",
  },
];

const CHIPS = [
  { label: "🔥 going", top: "12%", left: "-6%", accent: "#FF5BFC" },
  { label: "see you there", top: "34%", right: "-8%", accent: "#3FDCFF" },
  { label: "📍 saved", bottom: "26%", left: "-9%", accent: "#8A40CF" },
  { label: "this lineup 🤯", bottom: "8%", right: "-5%", accent: "#3FDCFF" },
];

export function SocialFeedPreview() {
  const ref = useGsapScope((self) => {
    const track = self.querySelector<HTMLElement>(".dvnt-feed-track");
    const screen = self.querySelector<HTMLElement>(".dvnt-feed-screen");
    const chips = gsap.utils.toArray<HTMLElement>(".dvnt-feed-chip", self);

    if (track && screen) {
      gsap.to(track, {
        y: () => -(track.scrollHeight - screen.clientHeight),
        ease: "none",
        scrollTrigger: {
          trigger: self,
          start: "top 60%",
          end: "bottom bottom",
          scrub: 1,
        },
      });
    }

    chips.forEach((chip, i) => {
      gsap.fromTo(
        chip,
        { autoAlpha: 0, y: 28 },
        {
          autoAlpha: 1,
          y: 0,
          ease: "power3.out",
          scrollTrigger: {
            trigger: self,
            start: `top ${55 - i * 6}%`,
            end: "bottom bottom",
            scrub: 1,
          },
        },
      );
      // gentle continuous float once visible
      gsap.to(chip, {
        y: "+=10",
        duration: 2.4 + i * 0.35,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        delay: i * 0.2,
      });
    });

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.vars.trigger === self && t.kill());
    };
  });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      aria-label="Stories & Feed"
      style={styles.section}
    >
      <style>{CSS}</style>

      <div style={styles.inner}>
       <div style={styles.copyCol}>
        <span style={styles.kicker}>Stories &amp; Feed</span>
        <h2 style={styles.h2}>The night doesn&apos;t end at the door.</h2>
        <p style={styles.sub}>
          Post photos. Share stories. Start conversations. Keep the scene alive.
        </p>
        <ul style={styles.bullets}>
          <li className="dvnt-feed-bullet" style={styles.bullet}>Stories from the people who were actually there</li>
          <li className="dvnt-feed-bullet" style={styles.bullet}>Recaps, comments, and live video rooms</li>
          <li className="dvnt-feed-bullet" style={styles.bullet}>Your scene — not an algorithm&apos;s</li>
        </ul>
       </div>

       <div style={styles.stage}>
        {CHIPS.map((c) => (
          <div
            key={c.label}
            className="dvnt-feed-chip"
            style={{
              ...styles.chip,
              top: c.top,
              left: c.left,
              right: c.right,
              bottom: c.bottom,
              boxShadow: `0 12px 34px ${c.accent}40`,
            }}
          >
            <span style={{ ...styles.chipDot, background: c.accent, boxShadow: `0 0 8px ${c.accent}` }} />
            {c.label}
          </div>
        ))}

        <div style={styles.phone}>
          <span style={styles.notch} />
          <div className="dvnt-feed-screen" style={styles.screen}>
            <div className="dvnt-feed-track" style={styles.track}>
              {/* App bar */}
              <div style={styles.appbar}>
                <span style={styles.wordmark}>DVNT</span>
                <span style={styles.appbarDot} />
              </div>

              {/* Stories row */}
              <div style={styles.storiesRow}>
                {STORIES.map((s) => (
                  <div key={s.name} style={styles.story}>
                    <span style={{ ...styles.storyRing, background: s.ring }}>
                      <span style={styles.storyInner} />
                    </span>
                    <span style={styles.storyName}>{s.name}</span>
                  </div>
                ))}
              </div>

              {/* Feed posts */}
              {POSTS.map((p) => (
                <article key={p.handle} style={styles.post}>
                  <header style={styles.postHead}>
                    <span style={{ ...styles.avatar, background: p.avatar }} />
                    <span style={styles.postMeta}>
                      <span style={styles.postName}>{p.name}</span>
                      <span style={styles.postHandle}>{p.handle}</span>
                    </span>
                  </header>
                  <p style={styles.postText}>{p.text}</p>
                  <span style={{ ...styles.postImage, background: p.image }} />
                  <div style={styles.postActions}>
                    <span style={styles.action}>♥ 248</span>
                    <span style={styles.action}>💬 32</span>
                    <span style={styles.action}>↗ share</span>
                  </div>
                </article>
              ))}

              {/* Event recap */}
              <article style={styles.recap}>
                <span style={styles.recapTag}>Event recap</span>
                <span style={styles.recapTitle}>Neon Cathedral · Sat</span>
                <div style={styles.recapStrip}>
                  <span style={{ ...styles.recapTile, background: "linear-gradient(135deg,#8A40CF,#3FDCFF)" }} />
                  <span style={{ ...styles.recapTile, background: "linear-gradient(135deg,#FF5BFC,#8A40CF)" }} />
                  <span style={{ ...styles.recapTile, background: "linear-gradient(135deg,#3FDCFF,#FF5BFC)" }} />
                </div>
              </article>

              {/* Comments */}
              <div style={styles.comments}>
                <div style={styles.comment}>
                  <span style={{ ...styles.cAvatar, background: "linear-gradient(135deg,#3FDCFF,#8A40CF)" }} />
                  <span style={styles.cBody}>
                    <b style={styles.cName}>mia</b> the visuals were unreal 😮‍💨
                  </span>
                </div>
                <div style={styles.comment}>
                  <span style={{ ...styles.cAvatar, background: "linear-gradient(135deg,#FF5BFC,#8A40CF)" }} />
                  <span style={styles.cBody}>
                    <b style={styles.cName}>kiko</b> saving the date for next one
                  </span>
                </div>
              </div>

              {/* Video chat preview tile */}
              <div style={styles.videoTile}>
                <span style={styles.videoTag}>Live · video chat</span>
                <div style={styles.videoFaces}>
                  <span style={{ ...styles.face, background: "linear-gradient(135deg,#8A40CF,#3FDCFF)" }} />
                  <span style={{ ...styles.face, background: "linear-gradient(135deg,#FF5BFC,#8A40CF)" }} />
                  <span style={{ ...styles.face, background: "linear-gradient(135deg,#3FDCFF,#FF5BFC)" }} />
                </div>
              </div>

              {/* Friends */}
              <div style={styles.friends}>
                <span style={styles.friendsLabel}>In the scene</span>
                <div style={styles.friendsRow}>
                  {STORIES.map((s) => (
                    <span key={s.name} style={{ ...styles.friendAvatar, background: s.ring }} />
                  ))}
                  <span style={styles.friendMore}>+18</span>
                </div>
              </div>

              <div style={styles.trackTail} />
            </div>
          </div>
          <span style={styles.homebar} />
        </div>
       </div>
      </div>
    </section>
  );
}

const CSS = `
.dvnt-feed-bullet::before {
  content: ""; position: absolute; left: 0; top: 8px; width: 8px; height: 8px;
  border-radius: 50%; background: linear-gradient(135deg, #3FDCFF, #FF5BFC);
  box-shadow: 0 0 8px rgba(63,220,255,0.5);
}
@media (max-width: 760px) {
  .dvnt-feed-chip { display: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  .dvnt-feed-track, .dvnt-feed-chip { transform: none !important; animation: none !important; }
}`;

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    paddingTop: 96,
    paddingBottom: 120,
    paddingLeft: 24,
    paddingRight: 24,
    background: "transparent",
  },
  inner: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 56,
  },
  copyCol: { flex: "1 1 360px", maxWidth: 520, textAlign: "left" },
  kicker: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 4,
    textTransform: "uppercase",
    color: "#3FDCFF",
  },
  h2: {
    margin: "14px 0 0",
    fontFamily: '"Republica-Minor", system-ui, sans-serif',
    fontWeight: 800,
    fontSize: "clamp(28px,4.4vw,52px)",
    lineHeight: 1.08,
    letterSpacing: -1.5,
    color: "#FAFAF9",
  },
  sub: {
    margin: "18px 0 0",
    maxWidth: 460,
    fontSize: 17,
    lineHeight: 1.55,
    color: "rgba(231,229,228,0.72)",
  },
  bullets: {
    listStyle: "none",
    margin: "24px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  bullet: {
    position: "relative",
    paddingLeft: 22,
    fontSize: 15,
    lineHeight: 1.5,
    color: "rgba(231,229,228,0.78)",
  },

  stage: {
    position: "relative",
    flex: "0 0 auto",
    width: 340,
    display: "flex",
    justifyContent: "center",
  },

  // Phone frame
  phone: {
    position: "relative",
    width: 280,
    height: 580,
    borderRadius: 46,
    background: "#0A0A12",
    border: "1px solid rgba(255,255,255,0.22)",
    boxShadow: "0 24px 60px rgba(138,64,207,0.5)",
    padding: 12,
    overflow: "hidden",
  },
  notch: {
    position: "absolute",
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    width: 120,
    height: 26,
    borderRadius: 16,
    background: "#02030A",
    border: "1px solid rgba(255,255,255,0.10)",
    zIndex: 6,
  },
  homebar: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    width: 110,
    height: 5,
    borderRadius: 3,
    background: "rgba(255,255,255,0.4)",
    zIndex: 6,
  },
  screen: {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: 36,
    overflow: "hidden",
    background:
      "radial-gradient(120% 90% at 50% 0%, rgba(138,64,207,0.20), #02030A 70%)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  track: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    padding: "44px 14px 0",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    willChange: "transform",
  },

  appbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: {
    fontFamily: '"Republica-Minor", monospace',
    fontWeight: 800,
    fontSize: 16,
    letterSpacing: 3,
    color: "#FAFAF9",
  },
  appbarDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#FF5BFC",
    boxShadow: "0 0 8px #FF5BFC",
  },

  storiesRow: { display: "flex", gap: 12, overflow: "hidden" },
  story: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5 },
  storyRing: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    padding: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  storyInner: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    background: "#0A0A12",
    border: "2px solid #02030A",
  },
  storyName: { fontSize: 10, color: "rgba(231,229,228,0.66)" },

  post: {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(8,10,20,0.7)",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  postHead: { display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: "50%", flexShrink: 0 },
  postMeta: { display: "flex", flexDirection: "column" },
  postName: { fontSize: 13, fontWeight: 700, color: "#FAFAF9" },
  postHandle: { fontSize: 11, color: "rgba(231,229,228,0.66)" },
  postText: { margin: 0, fontSize: 13, lineHeight: 1.45, color: "#FAFAF9" },
  postImage: {
    display: "block",
    width: "100%",
    height: 150,
    borderRadius: 14,
  },
  postActions: { display: "flex", gap: 16 },
  action: { fontSize: 12, color: "rgba(231,229,228,0.66)", fontWeight: 600 },

  recap: {
    borderRadius: 18,
    border: "1px solid rgba(63,220,255,0.3)",
    background: "linear-gradient(180deg, rgba(63,220,255,0.10), rgba(8,10,20,0.7))",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  recapTag: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#3FDCFF",
  },
  recapTitle: { fontSize: 14, fontWeight: 700, color: "#FAFAF9" },
  recapStrip: { display: "flex", gap: 8 },
  recapTile: { flex: 1, height: 64, borderRadius: 12 },

  comments: { display: "flex", flexDirection: "column", gap: 10 },
  comment: { display: "flex", alignItems: "flex-start", gap: 8 },
  cAvatar: { width: 26, height: 26, borderRadius: "50%", flexShrink: 0 },
  cBody: { fontSize: 12, lineHeight: 1.4, color: "rgba(231,229,228,0.85)" },
  cName: { color: "#FAFAF9", fontWeight: 700, marginRight: 4 },

  videoTile: {
    borderRadius: 18,
    border: "1px solid rgba(255,91,252,0.3)",
    background: "linear-gradient(135deg, rgba(138,64,207,0.25), rgba(255,91,252,0.12))",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  videoTag: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#FF5BFC",
  },
  videoFaces: { display: "flex", gap: 8 },
  face: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
  },

  friends: { display: "flex", flexDirection: "column", gap: 8 },
  friendsLabel: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "rgba(231,229,228,0.66)",
  },
  friendsRow: { display: "flex", alignItems: "center" },
  friendAvatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    marginLeft: -8,
    border: "2px solid #02030A",
  },
  friendMore: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: 700,
    color: "#FAFAF9",
  },

  trackTail: { height: 40 },

  // Floating glass chips
  chip: {
    position: "absolute",
    zIndex: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    color: "#FAFAF9",
    whiteSpace: "nowrap",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(10,10,18,0.6)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
  },
  chipDot: { width: 7, height: 7, borderRadius: "50%" },
};
