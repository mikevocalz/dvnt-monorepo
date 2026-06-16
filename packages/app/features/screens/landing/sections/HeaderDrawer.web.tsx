/**
 * Mobile nav drawer — WEB. Opens from the glass header's hamburger on narrow
 * viewports. Glass panel slides in from the right over a blurred scrim; nav
 * links stagger in; a flowing-gradient Login CTA anchors the bottom. Closes on
 * scrim tap, the ✕, Escape, or selecting a link. Body scroll locks while open.
 * Respects prefers-reduced-motion (transitions collapse to instant).
 * Native fallback: HeaderDrawer.tsx.
 */
import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import Logo from "@dvnt/app/components/logo";
import { clientNav } from "./client-nav";

interface NavItem {
  label: string;
  href: string;
}

/**
 * Drawer anchor — client-side nav (Solito useLink) so selecting a link doesn't
 * reload the whole document (which would remount the persistent header). Closes
 * the drawer after navigating.
 */
function DrawerLink({
  href,
  onClose,
  className,
  style,
  children,
}: {
  href: string;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={clientNav(router, href, onClose)}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}

export function HeaderDrawer({
  open,
  onClose,
  items,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  pathname: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const loginActive = pathname.startsWith("/auth");

  return (
    <div
      className={`dvnt-drawer-root${open ? " is-open" : ""}`}
      aria-hidden={!open}
      style={rootStyle}
    >
      <style>{CSS}</style>
      <div className="dvnt-drawer-scrim" onClick={onClose} style={scrimStyle} />

      <aside
        className="dvnt-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        style={panelStyle}
      >
        <div style={panelHead}>
          <Logo width={104} height={40} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="dvnt-drawer-close"
            style={closeBtn}
          >
            <span style={{ ...closeBar, transform: "rotate(45deg)" }} />
            <span style={{ ...closeBar, transform: "rotate(-45deg)" }} />
          </button>
        </div>

        <nav style={navWrap}>
          {items.map((item, i) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <DrawerLink
                key={item.label}
                href={item.href}
                onClose={onClose}
                className="dvnt-drawer-link"
                style={{
                  ...linkStyle,
                  ...(active ? linkActive : null),
                  transitionDelay: `${0.12 + i * 0.06}s`,
                }}
              >
                <span style={linkIndex}>0{i + 1}</span>
                {item.label}
              </DrawerLink>
            );
          })}
        </nav>

        <div style={panelFoot}>
          <DrawerLink
            href="/auth/login"
            onClose={onClose}
            className={`dvnt-drawer-login${loginActive ? " is-active" : ""}`}
            style={loginRing}
          >
            <span style={loginInner}>Login</span>
          </DrawerLink>
          <span style={tagline}>connect. gather. move.</span>
        </div>
      </aside>
    </div>
  );
}

const CSS = `
.dvnt-drawer-root { pointer-events: none; }
.dvnt-drawer-root.is-open { pointer-events: auto; }
.dvnt-drawer-scrim { opacity: 0; transition: opacity .42s ease; }
.dvnt-drawer-root.is-open .dvnt-drawer-scrim { opacity: 1; }
.dvnt-drawer-panel { transform: translateX(110%); transition: transform .5s cubic-bezier(0.22,1,0.36,1); }
.dvnt-drawer-root.is-open .dvnt-drawer-panel { transform: translateX(0); }
.dvnt-drawer-link { opacity: 0; transform: translateX(26px); transition: opacity .5s ease, transform .5s cubic-bezier(0.22,1,0.36,1); }
.dvnt-drawer-root.is-open .dvnt-drawer-link { opacity: 1; transform: translateX(0); }
.dvnt-drawer-link:hover { color: #3FDCFF; }
.dvnt-drawer-close:hover { border-color: rgba(255,255,255,0.4); }
.dvnt-drawer-login { animation: dvntDrawerGlow 2.6s ease-in-out infinite; }
@keyframes dvntDrawerGlow {
  0%,100% { box-shadow: 0 6px 18px rgba(138,64,207,0.4); }
  50% { box-shadow: 0 8px 24px rgba(63,220,255,0.45); }
}
.dvnt-drawer-login.is-active { outline: 2px solid rgba(63,220,255,0.8); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .dvnt-drawer-scrim, .dvnt-drawer-panel, .dvnt-drawer-link { transition: none !important; }
  .dvnt-drawer-login { animation: none !important; }
}`;

const rootStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 300,
};
const scrimStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(2,3,10,0.62)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};
const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  height: "100%",
  width: "min(86vw, 380px)",
  display: "flex",
  flexDirection: "column",
  padding: "26px 26px 34px",
  background:
    "linear-gradient(180deg, rgba(14,16,26,0.92), rgba(6,8,16,0.96))",
  borderLeft: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "-30px 0 80px rgba(0,0,0,0.55)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
};
const panelHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 38,
};
const closeBtn: React.CSSProperties = {
  position: "relative",
  width: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
};
const closeBar: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  width: 18,
  height: 2,
  marginLeft: -9,
  marginTop: -1,
  background: "#FAFAF9",
  borderRadius: 2,
};
const navWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flex: 1,
};
const linkStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 14,
  padding: "14px 0",
  fontFamily: "Republica-Minor",
  fontWeight: 800,
  fontSize: 30,
  letterSpacing: 1.5,
  color: "#FAFAF9",
  textDecoration: "none",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};
const linkActive: React.CSSProperties = { color: "#3FDCFF" };
const linkIndex: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(255,91,252,0.8)",
  letterSpacing: 1,
};
const panelFoot: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  alignItems: "stretch",
  marginTop: 26,
};
const loginRing: React.CSSProperties = {
  padding: 2,
  borderRadius: 15,
  backgroundImage:
    "linear-gradient(120deg, #3FDCFF 0%, #FF5BFC 33%, #8A40CF 66%, #3FDCFF 100%)",
  backgroundSize: "300% 300%",
  textDecoration: "none",
  animation: "dvntCenterFlow 4s ease infinite",
};
const loginInner: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "13px 0",
  borderRadius: 13,
  background: "#0A0118",
  color: "#fff",
  fontFamily: "Republica-Minor",
  fontWeight: 900,
  fontSize: 17,
  letterSpacing: 1,
};
const tagline: React.CSSProperties = {
  textAlign: "center",
  fontFamily: "monospace",
  fontSize: 12,
  letterSpacing: 1,
  color: "rgba(231,229,228,0.5)",
};
