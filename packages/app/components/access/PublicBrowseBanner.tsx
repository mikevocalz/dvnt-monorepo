import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Button } from "@dvnt/app/components/ui/button";

type PublicBrowseBannerVariant = "feed" | "events";

const COPY = {
  feed: {
    eyebrow: "WELCOME TO DVNT",
    title: "Explore what’s happening, connect, vibe, and move at your own pace.",
    description:
      "Sweet-only feed browsing is open right now. Create your account when you're ready to post, comment, or go deeper.",
    pills: ["Sweet-only preview", "Read-only", "Nearby culture"],
  },
  events: {
    eyebrow: "OUTSIDE TONIGHT?",
    title: "Browse events in your city before you hit a hard wall.",
    description:
      "See what is moving nearby now. Create your account to unlock full details, RSVP, and ticketing.",
    pills: ["Nearby events", "Read-only", "Low-friction preview"],
  },
} as const;

export function PublicBrowseBanner({
  variant,
}: {
  variant: PublicBrowseBannerVariant;
}) {
  const router = useRouter();
  const copy = COPY[variant];

  return (
    <View style={styles.outer}>
      <View style={styles.shell}>
        <LinearGradient
          colors={[
            "rgba(63,220,255,0.16)",
            "rgba(138,64,207,0.14)",
            "rgba(255,91,252,0.18)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          <View style={styles.pills}>
            {copy.pills.map((pill) => (
              <View key={pill} style={styles.pill}>
                <Text style={styles.pillText}>{pill}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.description}>{copy.description}</Text>

          <View style={styles.actions}>
            <Button
              onPress={() => router.push("/(auth)/signup" as any)}
              className="flex-1"
            >
              Join DVNT
            </Button>
            <Button
              variant="outline"
              onPress={() => router.push("/(auth)/login" as any)}
              className="flex-1"
            >
              Sign In
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  shell: {
    overflow: "hidden",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  content: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pillText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    fontWeight: "700",
  },
  eyebrow: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  description: {
    color: "rgba(228,228,231,0.84)",
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
});
