"use client";

import { create } from "zustand";
import { Lock, ChevronDown } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

/**
 * Web port of `../deviant/src/events/ui/GoingAccordion.tsx` — the existing
 * attendee row. Faithful: purple-tinted container, 30px rounded-square (r7) face
 * pile + "N going" + chevron, expandable 5-col grid of 44px (r10) avatar tiles.
 * Logged-out → 3 frosted tiles + Lock + "Sign in to see who's going" (the login
 * tease), never identities. BlurView → CSS backdrop-filter on web.
 */
export interface EventAttendee {
  id: string;
  username?: string;
  avatar?: string | null;
  initials?: string | null;
  color?: string | null;
}

const AVATAR_RADIUS = 10;
const COLS = 5;

// Per-instance expand state (the native uses event-detail-screen-store; web
// keeps it local + Zustand-always).
const useExpandStore = create<{ open: Record<string, boolean>; toggle: (id: string) => void }>((s) => ({
  open: {},
  toggle: (id) => s((p) => ({ open: { ...p.open, [id]: !p.open[id] } })),
}));

export interface GoingAccordionProps {
  /** Stable id (event id) for the expand state. */
  id: string;
  attendees: EventAttendee[];
  totalCount: number;
  /** Logged-out → blurred tease. Overridable; defaults to the auth store. */
  isLoggedIn?: boolean;
  restricted?: boolean;
  onAttendeePress?: (a: EventAttendee) => void;
  onRequireAuth?: () => void;
}

function Tile({ a, size }: { a: EventAttendee; size: number }) {
  return a.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={a.avatar} alt="" style={{ width: size, height: size, borderRadius: AVATAR_RADIUS, objectFit: "cover" }} />
  ) : (
    <span
      style={{
        width: size, height: size, borderRadius: AVATAR_RADIUS, background: a.color || "#4B2D7F",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: size * 0.32, fontWeight: 700,
      }}
    >
      {a.initials || a.username?.charAt(0)?.toUpperCase() || "?"}
    </span>
  );
}

export function GoingAccordion({ id, attendees, totalCount, isLoggedIn, restricted, onAttendeePress, onRequireAuth }: GoingAccordionProps) {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const loggedIn = (isLoggedIn ?? authed) && !restricted;
  const expanded = useExpandStore((s) => !!s.open[id]);
  const toggle = useExpandStore((s) => s.toggle);
  const preview = attendees.slice(0, 4);

  const container: React.CSSProperties = {
    background: "rgba(138,64,207,0.08)",
    borderRadius: 16,
    border: "1px solid rgba(138,64,207,0.15)",
    padding: 14,
    overflow: "hidden",
  };

  if (!loggedIn) {
    return (
      <div style={container}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {preview.slice(0, 3).map((a, i) => (
            <span
              key={a.id}
              style={{
                position: "relative", width: 30, height: 30, borderRadius: 7, overflow: "hidden",
                marginLeft: i > 0 ? -8 : 0, background: "rgba(8,10,18,0.4)",
                backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              }}
            >
              {a.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.avatar} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 7, objectFit: "cover", opacity: 0.3 }} />
              ) : null}
            </span>
          ))}
          <button
            onClick={onRequireAuth}
            style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, background: "transparent", border: 0, cursor: "pointer" }}
          >
            <Lock size={13} color="rgba(255,255,255,0.4)" />
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Sign in to see who&apos;s going</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      <button onClick={() => toggle(id)} style={{ display: "flex", alignItems: "center", width: "100%", background: "transparent", border: 0, cursor: "pointer", padding: 0 }}>
        <span style={{ display: "flex" }}>
          {preview.map((a, i) => (
            <span key={a.id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 7, border: "2px solid #000", overflow: "hidden", zIndex: 10 - i, display: "block" }}>
              <Tile a={a} size={30} />
            </span>
          ))}
        </span>
        <span style={{ flex: 1, marginLeft: 12, textAlign: "left" }}>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
            <span style={{ color: "#fff", fontWeight: 700 }}>{totalCount}</span> going
          </span>
          {attendees.length > 0 && !expanded ? (
            <span style={{ display: "block", color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 1 }}>Tap to see everyone</span>
          ) : null}
        </span>
        <ChevronDown size={18} color="rgba(255,255,255,0.5)" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.22,1,0.36,1)" }} />
      </button>

      <div
        style={{
          maxHeight: expanded ? 600 : 0,
          opacity: expanded ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 280ms cubic-bezier(0.22,1,0.36,1), opacity 280ms",
          marginTop: expanded ? 14 : 0,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {attendees.map((a) => (
            <button
              key={a.id}
              onClick={() => onAttendeePress?.(a)}
              style={{ width: `calc(${100 / COLS}% - 8px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "transparent", border: 0, cursor: "pointer" }}
            >
              <Tile a={a} size={44} />
              {a.username ? <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 500, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.username}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
