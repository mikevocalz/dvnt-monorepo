"use client";
/**
 * AppShell (web) — the persistent three-column shell for authed app surfaces,
 * per PROMPT 13 §1. Structure borrowed from IG/X (left icon+label rail · centered
 * content · right contextual aside); the skin is 100% DVNT (glass-on-near-black,
 * the teal-blue→purple gradient signature, the display wordmark, hairline
 * borders) — an after-dark members-only room, not a social dashboard.
 *
 *   <AppShell aside={<SomeContextualPanel/>}>{routeContent}</AppShell>
 *
 * Responsive (one component, switches by breakpoint):
 *  - ≥1280  rail (expanded, labels) · center · right aside
 *  - ≥1024  rail (expanded) · center            (aside drops first)
 *  - ≥768   rail (icon-only)  · center          (IG mid-width collapse)
 *  - <768   center · the existing bottom WebTabBar (rail is web-only; phones
 *           keep their tab bar)
 *
 * The `aside` slot is RESERVED INFRA — empty-safe today, architected so a future
 * sponsored-events / suggested-follows panel drops in without re-layout.
 */
import { useRouter, usePathname } from "solito/navigation";
import { useWindowDimensions } from "react-native";
import {
  Home,
  Calendar,
  BookOpen,
  Search,
  Heart,
  MessageCircle,
  User,
  Plus,
} from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import Logo from "@dvnt/app/components/logo";
import { WebTabBar } from "./web-tab-bar.web";

const ACCENT = "#379ED8"; // teal-blue (refined brand)
const HEADER_FONT = "Republica-Minor"; // the display font (Create CTA)
// Nav items use a crisp upright system sans — the display font reads slanted and
// hard on the eye at nav size.
const MENU_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Create button — same flowing-gradient-ring + pulsing-glow + hover treatment as
// the marketing Login button (HeaderLoginButton.web), so the two read as one
// family. Pure CSS on a real <button>; respects prefers-reduced-motion.
const CREATE_CSS = `
@keyframes dvntCreateFlow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
@keyframes dvntCreateGlow {
  0%,100%{ box-shadow:0 4px 14px rgba(138,64,207,0.38),0 0 7px rgba(255,91,252,0.24) }
  50%{ box-shadow:0 6px 18px rgba(138,64,207,0.55),0 0 11px rgba(63,220,255,0.40) }
}
.dvnt-create-btn {
  background-image: linear-gradient(120deg,#3FDCFF 0%,#FF5BFC 33%,#8A40CF 66%,#3FDCFF 100%);
  background-size: 300% 300%;
  animation: dvntCreateFlow 4s ease infinite, dvntCreateGlow 2.4s ease-in-out infinite;
  transition: transform 180ms cubic-bezier(0.22,1,0.36,1);
}
.dvnt-create-btn:hover { transform: translateY(-1px) scale(1.03); }
.dvnt-create-btn:active { transform: translateY(0) scale(0.98); }
@media (prefers-reduced-motion: reduce){ .dvnt-create-btn{ animation:none !important } }
`;

type NavItem = { href: string; Icon: typeof Home; label: string };

function isActive(pathname: string, href: string): boolean {
  if (href === "/feed") return pathname === "/feed" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const username = useAuthStore((s) => s.user?.username);

  // Phones keep their bottom tab bar — the rail is web/desktop-only.
  if (width < 768) {
    return (
      <>
        {children}
        <WebTabBar />
      </>
    );
  }

  const expanded = width >= 1024; // rail shows labels
  // The right aside is reserved but currently empty — only carve out its column
  // when a panel is actually passed, so the center (feed/blog) gets the full
  // remaining width ("3xl worth of space") instead of a dead 320px gutter.
  const showAside = width >= 1280 && !!aside;
  const railW = expanded ? 244 : 78;

  const items: NavItem[] = [
    { href: "/feed", Icon: Home, label: "Home" },
    { href: "/events", Icon: Calendar, label: "Events" },
    { href: "/blog", Icon: BookOpen, label: "Blog" },
    { href: "/feed/search", Icon: Search, label: "Search" },
    { href: "/notifications", Icon: Heart, label: "Activity" },
    { href: "/feed/messages", Icon: MessageCircle, label: "Messages" },
    {
      href: username ? `/profile/${username}` : "/profile",
      Icon: User,
      label: "Profile",
    },
  ];

  const NavRow = ({ href, Icon, label }: NavItem) => {
    const active = isActive(pathname, href);
    return (
      <button
        onClick={() => router.push(href)}
        title={label}
        aria-current={active ? "page" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          width: "100%",
          padding: expanded ? "13px 16px" : "13px 0",
          justifyContent: expanded ? "flex-start" : "center",
          borderRadius: 12,
          background: active ? "rgba(55,158,216,0.10)" : "transparent",
          boxShadow: active ? `inset 2px 0 0 ${ACCENT}` : undefined,
          // White text in both states (active reads via weight + tint + accent
          // icon); inactive is a hair softer so the active row still leads.
          color: active ? "#FFFFFF" : "rgba(255,255,255,0.92)",
          fontFamily: MENU_FONT,
          fontWeight: active ? 700 : 600,
          fontSize: 15.5,
          letterSpacing: 0.2,
          cursor: "pointer",
          border: "none",
          transition: "background 140ms ease, color 140ms ease",
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = "transparent";
        }}
      >
        <Icon size={24} strokeWidth={active ? 2.4 : 2} color={active ? ACCENT : "rgba(255,255,255,0.82)"} />
        {expanded ? <span>{label}</span> : null}
      </button>
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showAside
          ? `${railW}px minmax(0, 1fr) 320px`
          : `${railW}px minmax(0, 1fr)`,
        minHeight: "100dvh",
        background: "#06070D",
      }}
    >
      {/* ── Left rail (liquid glass) ── */}
      <nav
        aria-label="Primary"
        style={{
          position: "sticky",
          top: 0,
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
          padding: expanded ? "22px 14px 18px" : "22px 10px 18px",
          gap: 10,
          borderRight: "1px solid rgba(255,255,255,0.10)",
          // Liquid glass: translucent base + heavy saturated blur + a soft
          // top-light sheen so it reads as frosted glass, not a flat panel.
          backgroundColor: "rgba(10,12,22,0.42)",
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 22%, rgba(255,255,255,0) 60%)",
          backdropFilter: "saturate(185%) brightness(1.06) blur(22px)",
          WebkitBackdropFilter: "saturate(185%) brightness(1.06) blur(22px)",
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Logo — the same DVNT mark as the marketing header. Scaled to fit the
            rail at both widths so the collapsed rail never clips it. */}
        <button
          onClick={() => router.push("/feed")}
          title="DVNT"
          aria-label="DVNT home"
          style={{
            display: "flex",
            justifyContent: expanded ? "flex-start" : "center",
            alignItems: "center",
            padding: expanded ? "2px 12px 20px" : "2px 0 20px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            overflow: "visible",
          }}
        >
          {expanded ? (
            <Logo width={112} height={43} />
          ) : (
            <Logo width={railW - 26} height={(railW - 26) * 0.385} />
          )}
        </button>

        {/* 40px breathing room between the logo and the first nav item. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 40 }}>
          {items.map((it) => (
            <NavRow key={it.href} {...it} />
          ))}
        </div>

        {/* Spacer pushes Create to the BOTTOM of the rail. */}
        <div style={{ flex: 1 }} />

        {/* Create — animated to match the Login button (flowing gradient ring +
            pulsing glow + hover lift), pinned to the bottom with a 20px margin. */}
        <style>{CREATE_CSS}</style>
        <button
          onClick={() => router.push("/feed/create")}
          title="Create"
          aria-label="Create"
          className="dvnt-create-btn"
          style={{
            marginTop: 14,
            marginBottom: 20,
            padding: 2, // the visible gradient ring
            borderRadius: 14,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "block",
            width: "100%",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: expanded ? "12px 16px" : "12px 0",
              borderRadius: 12,
              background: "transparent", // let the flowing gradient FILL the button
              color: "#FFFFFF",
              fontFamily: HEADER_FONT,
              fontWeight: 900,
              fontSize: 16,
              letterSpacing: 1,
            }}
          >
            <Plus size={20} strokeWidth={2.8} color="#FFFFFF" />
            {expanded ? <span>Create</span> : null}
          </span>
        </button>
      </nav>

      {/* ── Center column ── fills the available track (IG/X width), the inner
           screens cap themselves (the feed grid is responsive). overflowX hidden
           so a child can never spawn a horizontal scrollbar on the shell. */}
      <main
        style={{
          minWidth: 0,
          width: "100%",
          margin: "0 auto",
          overflowX: "hidden",
        }}
      >
        {children}
      </main>

      {/* ── Right aside (reserved, empty-safe) ── */}
      {showAside ? (
        <aside
          aria-label="Contextual"
          style={{
            position: "sticky",
            top: 0,
            height: "100dvh",
            padding: "22px 18px",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            overflowY: "auto",
          }}
        >
          {aside ?? null}
        </aside>
      ) : null}
    </div>
  );
}
