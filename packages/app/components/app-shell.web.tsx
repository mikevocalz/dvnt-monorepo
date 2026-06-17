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
import { WebTabBar } from "./web-tab-bar";

const ACCENT = "#379ED8"; // teal-blue (refined brand)
const HEADER_FONT = "Republica-Minor"; // matches the marketing header nav (FAQ, Privacy…)
const MUTED = "rgba(255,255,255,0.58)";
const GRADIENT = "linear-gradient(120deg, #0F4961 0%, #379ED8 38%, #874E9F 72%, #5B2C81 100%)";

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
          gap: 14,
          width: "100%",
          padding: expanded ? "11px 14px" : "11px 0",
          justifyContent: expanded ? "flex-start" : "center",
          borderRadius: 12,
          background: active ? "rgba(55,158,216,0.10)" : "transparent",
          boxShadow: active ? `inset 2px 0 0 ${ACCENT}` : undefined,
          color: active ? "#FFFFFF" : MUTED,
          fontFamily: HEADER_FONT,
          fontWeight: active ? 700 : 500,
          fontSize: 16,
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
        <Icon size={24} strokeWidth={active ? 2.4 : 2} color={active ? ACCENT : MUTED} />
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
          gap: 6,
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

        {items.map((it) => (
          <NavRow key={it.href} {...it} />
        ))}

        {/* Create — the brand-gradient CTA */}
        <button
          onClick={() => router.push("/feed/create")}
          title="Create"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginTop: 14,
            padding: expanded ? "12px 16px" : "12px 0",
            borderRadius: 12,
            border: "none",
            background: GRADIENT,
            color: "#FFFFFF",
            fontFamily: HEADER_FONT,
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: 0.5,
            cursor: "pointer",
            boxShadow: "0 8px 22px rgba(135,78,159,0.28)",
          }}
        >
          <Plus size={20} strokeWidth={2.8} color="#FFFFFF" />
          {expanded ? <span>Create</span> : null}
        </button>

        <div style={{ flex: 1 }} />
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
