/**
 * CenterButton — WEB variant. Same API as center-button.tsx, but the native
 * react-native-animated-glow has no web build, so the glow is reproduced in CSS
 * (white squircle + flowing gradient ring + pulsing glow). Used by the web tab
 * bar; native keeps the animated-glow version.
 */
import type { ComponentType } from "react";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

type CenterButtonProps = {
  Icon: ComponentType<IconProps>;
  onPress?: () => void;
  accessoryPlacement?: "regular" | "inline";
};

export function CenterButton({ Icon, onPress }: CenterButtonProps) {
  return (
    <button
      type="button"
      className="dvnt-center-btn"
      onClick={onPress}
      aria-label="Create"
      style={ring}
    >
      <style>{CSS}</style>
      <span style={inner}>
        <Icon size={26} strokeWidth={2.8} color="#0A0118" />
      </span>
    </button>
  );
}

const CSS = `
@keyframes dvntCenterFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes dvntCenterGlow {
  0%, 100% { box-shadow: 0 4px 10px rgba(138,64,207,0.35), 0 0 6px rgba(255,91,252,0.22); }
  50% { box-shadow: 0 5px 12px rgba(138,64,207,0.5), 0 0 9px rgba(63,220,255,0.35); }
}
@media (prefers-reduced-motion: reduce) { .dvnt-center-btn { animation: none !important; } }`;

const ring: React.CSSProperties = {
  flexShrink: 0,
  width: 62,
  height: 62,
  marginTop: -28,
  padding: 3,
  borderRadius: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  cursor: "pointer",
  backgroundImage:
    "linear-gradient(120deg, #3FDCFF 0%, #FF5BFC 33%, #8A40CF 66%, #3FDCFF 100%)",
  backgroundSize: "300% 300%",
  animation:
    "dvntCenterFlow 4s ease infinite, dvntCenterGlow 2.4s ease-in-out infinite",
};
const inner: React.CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: 17,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#FFFFFF",
};
