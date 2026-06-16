"use client";

import { useRouter } from "solito/navigation";
import { MapPin, Clock, Users, Calendar, Zap } from "lucide-react";
import { EventFlyer, type EventFlyerMedia } from "@dvnt/app/components/event/EventFlyer.web";
import { color } from "@dvnt/app/lib/theme";

/**
 * Web port of `../deviant/components/feed/feed-event-card.tsx` — the existing
 * inline feed event card (200px full-bleed hero, gradient overlay, category pill
 * + date badge, "EVENT" label, title, venue/time/attendee-count). Faithful to
 * that design; the ONLY change is the hero uses the EventFlyer precedence so a
 * media-less event shows the generated fallback instead of the deviant card's
 * empty `#111` (Phase 4 mandate). `promoted` is the new boost treatment (Phase 3).
 */
export interface FeedEventCardData {
  id: string;
  slug?: string;
  title: string;
  category?: string | null;
  /** Day number for the date badge (e.g. "20"). */
  dateDay?: string | null;
  /** Uppercase month (e.g. "JUN"). */
  month?: string | null;
  location?: string | null;
  time?: string | null;
  attendeeCount?: number;
  cancelled?: boolean;
  promoted?: boolean;
  media: EventFlyerMedia;
}

const CARD_HEIGHT = 200;

export function FeedEventCard({ data }: { data: FeedEventCardData }) {
  const router = useRouter();
  const open = () => router.push(`/events/${data.slug ?? data.id}`);

  return (
    <div style={{ padding: "12px 4px" }}>
      <div
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" ? open() : undefined)}
        style={{ position: "relative", height: CARD_HEIGHT, borderRadius: 16, overflow: "hidden", background: "#111", cursor: "pointer" }}
      >
        {/* hero — flyer precedence (video → image → generated fallback) */}
        <div style={{ position: "absolute", inset: 0 }}>
          <EventFlyer
            media={{ ...data.media, eventId: data.media.eventId ?? data.id }}
            autoplay
            aspect={CARD_HEIGHT / CARD_HEIGHT}
            rounded={0}
          />
        </div>

        {/* gradient overlay (matches deviant: 0.1 → 0.3 → 0.85) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0.85) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* top row: category pill / cancelled · date badge */}
        <div style={{ position: "absolute", top: 12, left: 14, right: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          {data.cancelled ? (
            <span style={pill("rgba(239,68,68,0.85)")}>Cancelled</span>
          ) : data.promoted ? (
            <span style={{ ...pill("rgba(8,10,18,0.6)"), display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Zap size={10} color={color.gold} /> Promoted
            </span>
          ) : data.category ? (
            <span style={pill("rgba(138,64,207,0.7)")}>{data.category}</span>
          ) : (
            <span />
          )}
          {data.dateDay || data.month ? (
            <span style={{ background: "rgba(0,0,0,0.6)", borderRadius: 12, padding: "6px 10px", minWidth: 46, textAlign: "center", display: "inline-block" }}>
              {data.dateDay ? <span style={{ display: "block", color: "#fff", fontSize: 18, fontWeight: 800, fontFamily: "SpaceMono, ui-monospace, monospace" }}>{data.dateDay}</span> : null}
              {data.month ? <span style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{data.month}</span> : null}
            </span>
          ) : null}
        </div>

        {/* bottom content */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <Calendar size={10} color="rgba(63,220,255,0.9)" />
            <span style={{ color: "rgba(63,220,255,0.9)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Event</span>
          </div>
          <h3 style={{ margin: "0 0 6px", color: "#fff", fontSize: 18, fontWeight: 800, lineHeight: "22px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {data.title}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {data.location ? (
              <span style={meta}><MapPin size={10} color="rgba(255,255,255,0.5)" /> <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.location}</span></span>
            ) : null}
            {data.time ? <span style={meta}><Clock size={10} color="rgba(255,255,255,0.5)" /> {data.time}</span> : null}
            {data.attendeeCount ? <span style={meta}><Users size={10} color="rgba(255,255,255,0.5)" /> {data.attendeeCount}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function pill(bg: string): React.CSSProperties {
  return { background: bg, padding: "4px 10px", borderRadius: 10, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };
}
const meta: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, color: "rgba(255,255,255,0.7)", fontSize: 11 };
