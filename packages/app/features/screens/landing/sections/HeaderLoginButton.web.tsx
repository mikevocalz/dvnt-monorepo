/**
 * Header "Login" button — WEB variant.
 *
 * Same signature treatment as the web tab bar's CenterButton
 * (packages/app/components/center-button.web.tsx): a flowing
 * cyan→magenta→purple gradient *ring* (the border) wrapping an inner surface,
 * plus a pulsing box-shadow glow. Here the inner surface is dark with white
 * text (vs the CenterButton's white squircle), so it reads as a gradient
 * border on the glass header. Pure CSS on a real DOM <a>; respects
 * prefers-reduced-motion.
 */
import type { ComponentType } from "react";
import { useRouter } from "solito/navigation";
import { clientNav } from "./client-nav";

export function HeaderLoginButton({ active }: { active?: boolean }) {
  // Client-side nav so the persistent header doesn't reload/jump. See clientNav.
  const router = useRouter();
  return (
    <a
      href="/auth/login"
      onClick={clientNav(router, "/auth/login")}
      className={`dvnt-login-btn${active ? " is-active" : ""}`}
      aria-label="Login"
      style={ring}
    >
      <style>{CSS}</style>
      <span style={inner}>
        <span style={label}>Login</span>
      </span>
    </a>
  );
}

// Flow + glow keyframes shared with CenterButton so the two read as one family.
const CSS = `
@keyframes dvntCenterFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes dvntLoginGlow {
  0%, 100% { box-shadow: 0 4px 14px rgba(138,64,207,0.38), 0 0 7px rgba(255,91,252,0.24); }
  50% { box-shadow: 0 6px 18px rgba(138,64,207,0.55), 0 0 11px rgba(63,220,255,0.40); }
}
.dvnt-login-btn {
  background-image: linear-gradient(120deg, #3FDCFF 0%, #FF5BFC 33%, #8A40CF 66%, #3FDCFF 100%);
  background-size: 300% 300%;
  animation: dvntCenterFlow 4s ease infinite, dvntLoginGlow 2.4s ease-in-out infinite;
  transition: transform 180ms cubic-bezier(0.22,1,0.36,1);
}
.dvnt-login-btn:hover { transform: translateY(-1px) scale(1.03); }
.dvnt-login-btn:active { transform: translateY(0) scale(0.98); }
.dvnt-login-btn.is-active { transform: scale(1.02); }
@media (prefers-reduced-motion: reduce) {
  .dvnt-login-btn { animation: none !important; }
}`;

// Outer = the flowing gradient ring. The 2px padding is the visible border.
const ring: React.CSSProperties = {
  marginLeft: 20,
  marginRight: 4,
  padding: 2,
  borderRadius: 12,
  display: "inline-flex",
  textDecoration: "none",
  cursor: "pointer",
};
// Inner = dark surface that masks the gradient to a thin border.
const inner: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  paddingTop: 10,
  paddingBottom: 10,
  paddingLeft: 20,
  paddingRight: 20,
  borderRadius: 10,
  background: "#0A0118",
};
const label: React.CSSProperties = {
  color: "#FFFFFF",
  fontFamily: "Republica-Minor",
  fontWeight: 900,
  fontSize: 18,
  letterSpacing: 1.5,
  lineHeight: "normal",
};

// Keeps the shared API parallel to the native split (unused on web).
export type HeaderLoginButtonExtra = ComponentType<unknown>;
