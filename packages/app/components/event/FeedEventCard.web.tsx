"use client";

import { useLayoutEffect, useRef } from "react";
import { webEventDetailRoute } from "@dvnt/app/lib/events/event-detail-route";
import { CardLink } from "@dvnt/app/components/ui/card-link.web";
import { MapPin, Clock, Users, Calendar, Zap } from "lucide-react";
import { EventFlyer, type EventFlyerMedia } from "@dvnt/app/components/event/EventFlyer.web";
import { color } from "@dvnt/app/lib/theme";
import { CARD_ASPECT, CARD_MAX_WIDTH, CARD_HORIZONTAL_PADDING, CARD_VERTICAL_PADDING } from "./feed-event-card-shape";

/** Portrait feed flyer with event details below the unobscured artwork. */
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

// Keep the existing export available to other feed consumers.
export { CARD_ASPECT } from "./feed-event-card-shape";

export function FeedEventCard({ data, onHeightChange }: {
  data: FeedEventCardData;
  onHeightChange?: (id: string, width: number, height: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element || !onHeightChange) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) onHeightChange(data.id, width, height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data.id, onHeightChange]);
  // Feed data carries a stable id; /events/[slug] resolves titles, not ids.
  const href = webEventDetailRoute(data.id);

  return (
    <div ref={cardRef} style={{ width: "100%", maxWidth: CARD_MAX_WIDTH, margin: "0 auto", boxSizing: "border-box", padding: `${CARD_VERTICAL_PADDING}px ${CARD_HORIZONTAL_PADDING}px` }}>
      <CardLink
        href={href}
        ariaLabel={`View event: ${data.title}`}
        style={{ display: "block", position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", background: "#111", cursor: "pointer" }}
      >
        {/* hero — flyer precedence (video → image → generated fallback) */}
        <div style={{ pointerEvents: "none" }}>
          <EventFlyer
            media={{ ...data.media, eventId: data.media.eventId ?? data.id }}
            autoplay
            aspect={CARD_ASPECT}
            rounded={0}
          />
        </div>

        <div style={{ boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px 14px" }}>
          {/* top row: category pill / cancelled · date badge */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
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
          <div>
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
      </CardLink>
    </div>
  );
}

function pill(bg: string): React.CSSProperties {
  return { background: bg, padding: "4px 10px", borderRadius: 10, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };
}
const meta: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: "14px" };


