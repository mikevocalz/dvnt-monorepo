/**
 * OrganizerCard (native) — posh.vip-style "Hosted by" section for the event
 * detail page. Renders the host's logo, verified name, aggregate stats
 * (events hosted · total attendees), social links, and Contact / Follow CTAs.
 *
 * Self-contained: fetches via useEventOrganizer(eventId) and toggles follow
 * through the shared useFollow mutation (optimistic, server-reconciled).
 * DVNT branding: rounded-square avatar (never circular), cyan #3FDCFF accent.
 *
 * Web sibling: ./OrganizerCard.web.tsx
 */
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { BadgeCheck, ChevronRight, Globe, Check, Plus } from "lucide-react-native";
import Svg, { Path, Rect, Circle } from "react-native-svg";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useEventOrganizer } from "@dvnt/app/lib/hooks/use-event-organizer";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import * as Linking from "expo-linking";

const ACCENT = "#3FDCFF";

function compact(n: number): string {
  return (n ?? 0).toLocaleString("en-US");
}

const ICON_COLOR = "rgba(255,255,255,0.8)";

/** Instagram brand glyph (lucide dropped its brand icons in this version). */
function InstagramGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Rect
        x={2}
        y={2}
        width={20}
        height={20}
        rx={5}
        stroke={ICON_COLOR}
        strokeWidth={2}
      />
      <Circle cx={12} cy={12} r={4} stroke={ICON_COLOR} strokeWidth={2} />
      <Circle cx={17.5} cy={6.5} r={1.2} fill={ICON_COLOR} />
    </Svg>
  );
}

/** X (Twitter) brand glyph. */
function XGlyph() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill={ICON_COLOR}>
      <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </Svg>
  );
}

export interface OrganizerCardProps {
  eventId: string;
  /** Override profile navigation (defaults to the protected profile route). */
  onPressProfile?: (username: string) => void;
}

export function OrganizerCard({ eventId, onPressProfile }: OrganizerCardProps) {
  const router = useRouter();
  const { data: org } = useEventOrganizer(eventId);
  const follow = useFollow();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Local follow state, seeded from the server and optimistically toggled.
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (org) setFollowing(org.isFollowing);
  }, [org?.isFollowing]);

  if (!org) return null;

  const displayName = org.name || org.username;
  const goToProfile = () => {
    if (onPressProfile) return onPressProfile(org.username);
    router.push(`/(protected)/profile/${org.username}` as any);
  };

  const handleFollow = () => {
    if (!isAuthenticated) {
      router.push("/(auth)/login" as any);
      return;
    }
    const next = !following;
    setFollowing(next); // optimistic
    follow.mutate(
      {
        userId: org.id,
        action: next ? "follow" : "unfollow",
        username: org.username,
      },
      { onError: () => setFollowing(!next) },
    );
  };

  const openLink = (url?: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  const { instagram, x, website } = org.socials;
  const hasSocials = Boolean(instagram || x || website);

  return (
    <View style={s.card}>
      {/* Top row — "Hosted by NAME ✓" + More events */}
      <View style={s.topRow}>
        <Pressable
          style={s.hostedBy}
          onPress={goToProfile}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={s.hostedByLabel}>Hosted by </Text>
          <Text style={s.hostedByName} numberOfLines={1}>
            {displayName}
          </Text>
          {org.verified ? (
            <BadgeCheck size={15} color="#34A2DF" style={{ marginLeft: 4 }} />
          ) : null}
        </Pressable>
        <Pressable style={s.moreEvents} onPress={goToProfile} hitSlop={8}>
          <Text style={s.moreEventsText}>More events</Text>
          <ChevronRight size={16} color="rgba(255,255,255,0.5)" />
        </Pressable>
      </View>

      {/* Logo + name + stats */}
      <Pressable style={s.identity} onPress={goToProfile}>
        <Avatar uri={org.avatar} username={org.username} size={88} />
        <Text style={s.orgName} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={s.statsRow}>
          <Text style={s.statNum}>{compact(org.eventsCount)}</Text>
          <Text style={s.statLabel}> events</Text>
          <Text style={s.statDivider}>·</Text>
          <Text style={s.statNum}>{compact(org.totalAttendees)}</Text>
          <Text style={s.statLabel}> attendees</Text>
        </View>
      </Pressable>

      {/* Social icons */}
      {hasSocials ? (
        <View style={s.socials}>
          {instagram ? (
            <Pressable
              style={s.socialBtn}
              onPress={() => openLink(instagram)}
              hitSlop={8}
            >
              <InstagramGlyph />
            </Pressable>
          ) : null}
          {x ? (
            <Pressable
              style={s.socialBtn}
              onPress={() => openLink(x)}
              hitSlop={8}
            >
              <XGlyph />
            </Pressable>
          ) : null}
          {website ? (
            <Pressable
              style={s.socialBtn}
              onPress={() => openLink(website)}
              hitSlop={8}
            >
              <Globe size={18} color={ICON_COLOR} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Actions */}
      {!org.isSelf ? (
        <View style={s.actions}>
          <Pressable style={[s.actionBtn, s.contactBtn]} onPress={goToProfile}>
            <Text style={s.contactText}>Contact</Text>
          </Pressable>
          <Pressable
            style={[s.actionBtn, following ? s.followingBtn : s.followBtn]}
            onPress={handleFollow}
            disabled={follow.isPending}
          >
            {following ? (
              <Check size={16} color="#fff" />
            ) : (
              <Plus size={16} color="#000" />
            )}
            <Text style={following ? s.followingText : s.followText}>
              {following ? "Following" : "Follow"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginTop: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hostedBy: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    marginRight: 8,
  },
  hostedByLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
  hostedByName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  moreEvents: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  moreEventsText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    fontWeight: "500",
  },
  identity: {
    alignItems: "center",
    marginTop: 18,
  },
  orgName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 12,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  statNum: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  statLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
  statDivider: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 14,
    marginHorizontal: 8,
  },
  socials: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  socialBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  contactBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "transparent",
  },
  contactText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  followBtn: {
    backgroundColor: ACCENT,
  },
  followText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "700",
  },
  followingBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  followingText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
