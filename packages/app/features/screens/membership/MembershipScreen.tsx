/**
 * Membership / paywall screen (universal).
 *
 * Reads the user's resolved entitlements (useEntitlements) and shows their
 * current plan plus the full tier ladder from the shared subscription model
 * (VIP flagged "Most Popular"). Selling is web-only (reader-app pattern): the
 * upgrade CTA opens the web /pricing page in the browser rather than charging
 * in-app, which keeps the iOS build App-Store compliant. The native app only
 * reads entitlements — it never sells.
 */
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useCallback } from "react";
import Animated from "react-native-reanimated";
import { Check, Crown, ExternalLink } from "lucide-react-native";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import {
  PLANS,
  MEMBERSHIP_PLAN_KEYS,
  type PlanKey,
} from "@dvnt/app/lib/subscription";

const WEB_BASE =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any)?.process?.env?.EXPO_PUBLIC_WEB_URL as string) ||
  "https://dvnt.app";

const C = {
  bg: "#02030A",
  card: "rgba(18,20,30,0.92)",
  border: "rgba(255,255,255,0.12)",
  text: "#FAFAF9",
  muted: "rgba(231,229,228,0.66)",
  cyan: "#3FDCFF",
  magenta: "#FF5BFC",
  purple: "#8A40CF",
};

function price(cents: number) {
  if (cents === 0) return "$0";
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}

async function openPricing(planKey?: PlanKey) {
  const url = `${WEB_BASE}/pricing${planKey ? `?plan=${planKey}` : ""}`;
  if (Platform.OS === "web") {
    (globalThis as typeof globalThis & { open?: (u: string) => void }).open?.(url);
    return;
  }
  try {
    const WebBrowser = await import("expo-web-browser");
    await WebBrowser.openBrowserAsync(url);
  } catch {
    const { Linking } = await import("react-native");
    Linking.openURL(url);
  }
}

export function MembershipScreen() {
  const { entitlements, isLoading } = useEntitlements();
  const currentKey = entitlements.planKey;

  const onUpgrade = useCallback((k: PlanKey) => openPricing(k), []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Animated.Text style={styles.kicker}>DVNT Membership</Animated.Text>
      <Animated.Text style={styles.title}>
        REAL PEOPLE. REAL CONNECTIONS.
      </Animated.Text>
      <Animated.Text style={styles.sub}>
        Unlock the best of our app and events. Every membership includes Sneaky
        Lynk access.
      </Animated.Text>

      {/* Current plan banner */}
      <View style={styles.currentBanner}>
        <Crown size={18} color={C.magenta} />
        <Animated.Text style={styles.currentText}>
          {isLoading
            ? "Checking your plan…"
            : `You're on ${PLANS[currentKey].name}`}
        </Animated.Text>
      </View>

      {MEMBERSHIP_PLAN_KEYS.map((key) => {
        const p = PLANS[key];
        const isCurrent = key === currentKey;
        const bullets = [...p.bullets.sneaky, ...p.bullets.events];
        return (
          <View
            key={key}
            style={[
              styles.card,
              p.recommended && styles.cardRec,
              isCurrent && styles.cardCurrent,
            ]}
          >
            <View style={styles.cardHead}>
              <Animated.Text style={styles.planName}>{p.name}</Animated.Text>
              {p.recommended ? (
                <Animated.Text style={styles.badge}>Most Popular</Animated.Text>
              ) : null}
              {isCurrent ? (
                <Animated.Text style={styles.current}>Current</Animated.Text>
              ) : null}
            </View>
            <View style={styles.priceRow}>
              <Animated.Text style={styles.price}>
                {price(p.priceCents)}
              </Animated.Text>
              <Animated.Text style={styles.per}>/month</Animated.Text>
            </View>
            {p.positioning ? (
              <Animated.Text style={styles.pos}>{p.positioning}</Animated.Text>
            ) : null}

            <View style={styles.bullets}>
              {bullets.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Check size={15} color={C.cyan} />
                  <Animated.Text style={styles.bulletText}>{b}</Animated.Text>
                </View>
              ))}
            </View>

            {!isCurrent && key !== "free" ? (
              <Pressable
                onPress={() => onUpgrade(key)}
                style={[styles.cta, p.recommended && styles.ctaRec]}
                accessibilityRole="button"
              >
                <Animated.Text style={styles.ctaText}>
                  {p.recommended ? "Get VIP" : "Choose plan"}
                </Animated.Text>
                <ExternalLink size={15} color="#0A0118" />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Animated.Text style={styles.fineprint}>
        Plans are managed on the web. Choosing a plan opens dvnt.app to complete
        checkout securely.
      </Animated.Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60, gap: 12 },
  kicker: {
    color: C.cyan,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  title: {
    color: C.text,
    fontFamily: "Republica-Minor",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 6,
  },
  sub: { color: C.muted, fontSize: 15, lineHeight: 22, marginTop: 4 },
  currentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,91,252,0.1)",
    borderColor: "rgba(255,91,252,0.3)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  currentText: { color: C.text, fontWeight: "700", fontSize: 15 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 18,
    marginTop: 4,
  },
  cardRec: { borderColor: C.magenta },
  cardCurrent: { borderColor: C.cyan },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  planName: {
    color: C.text,
    fontFamily: "Republica-Minor",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  badge: {
    color: "#0A0118",
    backgroundColor: C.magenta,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  current: {
    color: C.cyan,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8 },
  price: { color: C.text, fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  per: { color: C.muted, fontSize: 13 },
  pos: { color: C.muted, fontSize: 14, marginTop: 6 },
  bullets: { gap: 7, marginTop: 14 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletText: { color: "rgba(245,245,244,0.82)", fontSize: 14, lineHeight: 20, flex: 1 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: C.purple,
  },
  ctaRec: { backgroundColor: C.magenta },
  ctaText: { color: "#0A0118", fontWeight: "800", fontSize: 14 },
  fineprint: { color: "rgba(231,229,228,0.5)", fontSize: 12, lineHeight: 18, marginTop: 10 },
});
