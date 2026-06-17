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
import { WebTabBar } from "./web-tab-bar";

const ACCENT = "#379ED8"; // teal-blue (refined brand)
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
  const showAside = width >= 1280; // right aside appears
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
      {/* ── Left rail ── */}
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
          borderRight: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(8,10,18,0.55)",
          backdropFilter: "saturate(160%) blur(18px)",
          WebkitBackdropFilter: "saturate(160%) blur(18px)",
        }}
      >
        {/* Wordmark */}
        <button
          onClick={() => router.push("/feed")}
          title="DVNT"
          style={{
            display: "flex",
            justifyContent: expanded ? "flex-start" : "center",
            alignItems: "center",
            padding: expanded ? "4px 14px 18px" : "4px 0 18px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontWeight: 900,
              fontSize: expanded ? 26 : 20,
              letterSpacing: expanded ? 4 : 1,
              backgroundImage: GRADIENT,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            {expanded ? "DVNT" : "D"}
          </span>
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
            color: "#03040A",
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
            boxShadow: "0 8px 22px rgba(135,78,159,0.28)",
          }}
        >
          <Plus size={20} strokeWidth={2.6} color="#03040A" />
          {expanded ? <span>Create</span> : null}
        </button>

        <div style={{ flex: 1 }} />
      </nav>

      {/* ── Center column ── */}
      <main
        style={{
          minWidth: 0,
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          paddingLeft: 8,
          paddingRight: 8,
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
