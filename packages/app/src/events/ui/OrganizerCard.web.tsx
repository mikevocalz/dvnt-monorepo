"use client";
/**
 * OrganizerCard (web) — posh.vip-style "Hosted by" section for the event
 * detail page. Web port of ./OrganizerCard.tsx: host logo, verified name,
 * aggregate stats (events hosted · total attendees), social links, and
 * Contact / Follow CTAs.
 *
 * Self-contained: fetches via useEventOrganizer(eventId) and toggles follow
 * through the shared useFollow mutation. DVNT branding: rounded-square avatar
 * (never circular), cyan #3FDCFF accent.
 */
import { useEffect, useState } from "react";
import { useRouter } from "solito/navigation";
import { BadgeCheck, ChevronRight, Globe, Check, Plus } from "lucide-react";
import { useEventOrganizer } from "@dvnt/app/lib/hooks/use-event-organizer";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

const ICON = "rgba(255,255,255,0.8)";

function compact(n: number): string {
  return (n ?? 0).toLocaleString("en-US");
}

function InstagramGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <rect x={2} y={2} width={20} height={20} rx={5} stroke={ICON} strokeWidth={2} />
      <circle cx={12} cy={12} r={4} stroke={ICON} strokeWidth={2} />
      <circle cx={17.5} cy={6.5} r={1.2} fill={ICON} />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill={ICON}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

export interface OrganizerCardProps {
  eventId: string;
}

export function OrganizerCard({ eventId }: OrganizerCardProps) {
  const router = useRouter();
  const { data: org } = useEventOrganizer(eventId);
  const follow = useFollow();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (org) setFollowing(org.isFollowing);
  }, [org?.isFollowing]);

  if (!org) return null;

  const displayName = org.name || org.username;
  const goToProfile = () => router.push(`/profile/${org.username}`);

  const handleFollow = () => {
    if (!isAuthenticated) {
      router.push("/auth/login");
      return;
    }
    const next = !following;
    setFollowing(next); // optimistic
    follow.mutate(
      { userId: org.id, action: next ? "follow" : "unfollow", username: org.username },
      { onError: () => setFollowing(!next) },
    );
  };

  const { instagram, x, website } = org.socials;
  const hasSocials = Boolean(instagram || x || website);

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      {/* Top row */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={goToProfile}
          className="flex items-center min-w-0 text-left"
        >
          <span className="text-white/55 text-sm shrink-0">Hosted by&nbsp;</span>
          <span className="text-white text-sm font-bold truncate">{displayName}</span>
          {org.verified ? (
            <BadgeCheck size={15} color="#34A2DF" className="ml-1 shrink-0" />
          ) : null}
        </button>
        <button
          onClick={goToProfile}
          className="flex items-center gap-0.5 text-white/50 text-sm font-medium shrink-0 hover:text-white/80 transition-colors"
        >
          More events <ChevronRight size={16} />
        </button>
      </div>

      {/* Logo + name + stats */}
      <button onClick={goToProfile} className="w-full flex flex-col items-center mt-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={org.avatar}
          alt={displayName}
          className="rounded-2xl object-cover bg-white/10 border border-[#34A2DF]/40"
          style={{ width: 88, height: 88 }}
        />
        <span className="text-white text-lg font-bold mt-3">{displayName}</span>
        <div className="flex items-center mt-1.5 text-sm">
          <span className="text-white font-semibold">{compact(org.eventsCount)}</span>
          <span className="text-white/55">&nbsp;events</span>
          <span className="text-white/30 mx-2">·</span>
          <span className="text-white font-semibold">{compact(org.totalAttendees)}</span>
          <span className="text-white/55">&nbsp;attendees</span>
        </div>
      </button>

      {/* Socials */}
      {hasSocials ? (
        <div className="flex items-center justify-center gap-2.5 mt-4">
          {instagram ? (
            <a
              href={instagram}
              target="_blank"
              rel="noreferrer"
              className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label="Instagram"
            >
              <InstagramGlyph />
            </a>
          ) : null}
          {x ? (
            <a
              href={x}
              target="_blank"
              rel="noreferrer"
              className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label="X"
            >
              <XGlyph />
            </a>
          ) : null}
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label="Website"
            >
              <Globe size={18} color={ICON} />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Actions */}
      {!org.isSelf ? (
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={goToProfile}
            className="flex-1 h-11 rounded-xl border border-white/15 text-white text-[15px] font-semibold hover:bg-white/5 transition-colors"
          >
            Contact
          </button>
          <button
            onClick={handleFollow}
            disabled={follow.isPending}
            className={
              following
                ? "flex-1 h-11 rounded-xl border border-white/25 bg-white/[0.06] text-white text-[15px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                : "flex-1 h-11 rounded-xl bg-[#3FDCFF] text-black text-[15px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
            }
          >
            {following ? <Check size={16} /> : <Plus size={16} />}
            {following ? "Following" : "Follow"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
