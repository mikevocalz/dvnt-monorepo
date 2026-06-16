/**
 * Event ticket timeline — NATIVE base. Static React Native version (no gsap).
 *
 * Same kicker / headline / sub as the web split, with the five events in a
 * horizontal ScrollView. The web split (EventTicketTimeline.web.tsx) upgrades
 * this with a pinned GSAP horizontal-scroll timeline.
 */
import { StyleSheet, View, ScrollView } from "react-native";
import { Section, H2, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

interface EventCard {
  key: string;
  name: string;
  date: string;
  venue: string;
  accent: string;
  status: string;
  cta: string;
}

const EVENTS: EventCard[] = [
  {
    key: "synthesis",
    name: "SYNTHESIS: Open Rave",
    date: "FRI · JUN 27 · 10PM",
    venue: "The Foundry — Bushwick",
    accent: LANDING_COLORS.cyan,
    status: "Tickets Live",
    cta: "Buy Ticket",
  },
  {
    key: "vinyl",
    name: "Vinyl Lounge",
    date: "SAT · JUL 05 · 9PM",
    venue: "Sublabel — LES",
    accent: LANDING_COLORS.magenta,
    status: "Drops Jul 1",
    cta: "Notify Me",
  },
  {
    key: "afters",
    name: "Underground Afters",
    date: "SUN · JUL 06 · 4AM",
    venue: "Location on RSVP",
    accent: LANDING_COLORS.purple,
    status: "Few Left",
    cta: "Buy Ticket",
  },
  {
    key: "warehouse9",
    name: "Warehouse 9",
    date: "FRI · JUL 11 · 11PM",
    venue: "Pier 9 — Red Hook",
    accent: LANDING_COLORS.cyan,
    status: "Tickets Live",
    cta: "Buy Ticket",
  },
  {
    key: "rooftop",
    name: "Rooftop Reset",
    date: "SAT · JUL 19 · 6PM",
    venue: "Skyline 47 — Williamsburg",
    accent: LANDING_COLORS.magenta,
    status: "Drops Jul 14",
    cta: "Notify Me",
  },
];

export function EventTicketTimeline() {
  return (
    <Section style={styles.section}>
      <Animated.View style={styles.header}>
        <P style={styles.kicker}>EVENTS & TICKETS</P>
        <H2 style={styles.headline}>
          DVNT is the ticketing app for the people who actually go out.
        </H2>
        <P style={styles.sub}>
          Find events that match your scene. Get notified the moment tickets drop. Buy in
          seconds. Show up, scan in, post the night.
        </P>
      </Animated.View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
      >
        {EVENTS.map((ev) => (
          <View key={ev.key} style={styles.card}>
            <View style={[styles.flyer, { backgroundColor: ev.accent + "22" }]}>
              <View style={[styles.flyerAccent, { backgroundColor: ev.accent }]} />
              <P style={styles.flyerName}>{ev.name}</P>
              <View style={styles.qrBadge} />
            </View>

            <View style={styles.meta}>
              <P style={[styles.date, { color: ev.accent }]}>{ev.date}</P>
              <P style={styles.venue}>{ev.venue}</P>
            </View>

            <View style={styles.rsvpRow}>
              <View style={styles.avatars}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.avatar,
                      {
                        marginLeft: i === 0 ? 0 : -10,
                        backgroundColor: i % 2 === 0 ? ev.accent : LANDING_COLORS.purple,
                      },
                    ]}
                  />
                ))}
                <P style={styles.rsvpCount}>+128 going</P>
              </View>
              <View
                style={[
                  styles.statusPill,
                  { borderColor: ev.accent, backgroundColor: ev.accent + "1F" },
                ]}
              >
                <P style={[styles.statusText, { color: ev.accent }]}>{ev.status}</P>
              </View>
            </View>

            <View style={styles.stub}>
              <P style={styles.stubLabel}>TICKET STUB</P>
              <View style={styles.stubPerf} />
            </View>

            <View
              style={[
                styles.cta,
                ev.cta === "Buy Ticket"
                  ? { backgroundColor: ev.accent }
                  : { backgroundColor: "rgba(255,255,255,0.04)", borderColor: LANDING_COLORS.glassBorder, borderWidth: 1 },
              ]}
            >
              <P
                style={[
                  styles.ctaText,
                  { color: ev.cta === "Buy Ticket" ? LANDING_COLORS.bg : LANDING_COLORS.text },
                ]}
              >
                {ev.cta}
              </P>
            </View>
          </View>
        ))}
      </ScrollView>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "transparent",
    paddingVertical: 64,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 32,
    maxWidth: 640,
  },
  kicker: {
    fontFamily: "monospace",
    letterSpacing: 3,
    fontSize: 12,
    color: LANDING_COLORS.cyan,
    marginBottom: 14,
  },
  headline: {
    fontFamily: "Republica-Minor",
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    color: LANDING_COLORS.text,
    margin: 0,
  },
  sub: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 24,
    color: LANDING_COLORS.textMuted,
  },
  track: {
    paddingHorizontal: 24,
    gap: 18,
  },
  card: {
    width: 300,
    borderRadius: 20,
    padding: 18,
    backgroundColor: LANDING_COLORS.bgElevated,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 50,
    elevation: 8,
    gap: 14,
  },
  flyer: {
    height: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    padding: 14,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  flyerAccent: {
    position: "absolute",
    top: -40,
    left: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    opacity: 0.35,
  },
  flyerName: {
    fontFamily: "Republica-Minor",
    fontSize: 18,
    fontWeight: "700",
    color: LANDING_COLORS.text,
    maxWidth: "75%",
  },
  qrBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#0b0c14",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
  },
  meta: { gap: 4 },
  date: {
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: "600",
  },
  venue: { fontSize: 14, color: LANDING_COLORS.textMuted },
  rsvpRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatars: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#0b0c14",
  },
  rsvpCount: {
    marginLeft: 10,
    fontSize: 12,
    color: LANDING_COLORS.textMuted,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: {
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  stub: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: LANDING_COLORS.glassBorder,
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  stubLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: 2,
    color: LANDING_COLORS.textMuted,
  },
  stubPerf: {
    width: 50,
    height: 2,
    backgroundColor: LANDING_COLORS.glassBorderStrong,
  },
  cta: {
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontFamily: "Republica-Minor",
    fontSize: 15,
    fontWeight: "700",
  },
});
