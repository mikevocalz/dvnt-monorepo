import { useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { MapPin, Check } from "lucide-react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useEventsLocationStore, type City } from "@dvnt/app/lib/stores/events-location-store";
import { useOnboardingV2Store } from "@dvnt/app/lib/stores/onboarding-v2-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { citiesApi } from "@dvnt/app/lib/api/cities";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { IDENTITY_OPTIONS, AUDIENCE_OPTIONS } from "@dvnt/app/lib/constants/identity";
import { onboardingCheckpoint, onboardingFailure } from "@dvnt/observability/flows";
import { create } from "zustand";

/**
 * Native welcome flow (B1→B2): identity → event audience → location.
 * Mirror of WelcomeScreen.web — same options, same updateProfile persistence,
 * same self-skip when the profile already carries the data. Tokens per
 * docs/design-language-audit.md. State in Zustand per repo law.
 */

const P = "rgb(62, 164, 229)";

interface WelcomeUiState {
  step: number;
  identity: string[];
  audience: string;
  saving: boolean;
  locating: boolean;
  setStep: (n: number) => void;
  toggleIdentity: (v: string) => void;
  setAudience: (v: string) => void;
  setSaving: (v: boolean) => void;
  setLocating: (v: boolean) => void;
  reset: () => void;
}

const useWelcomeUiStore = create<WelcomeUiState>((set) => ({
  step: 0,
  identity: [],
  audience: "",
  saving: false,
  locating: false,
  setStep: (step) => set({ step }),
  toggleIdentity: (v) =>
    set((s) => ({
      identity: s.identity.includes(v)
        ? s.identity.filter((i) => i !== v)
        : [...s.identity, v],
    })),
  setAudience: (audience) => set({ audience }),
  setSaving: (saving) => set({ saving }),
  setLocating: (locating) => set({ locating }),
  reset: () => set({ step: 0, identity: [], audience: "", saving: false, locating: false }),
}));

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? P : "rgba(255,255,255,0.18)",
        backgroundColor: selected ? "rgba(62,164,229,0.16)" : "rgba(255,255,255,0.04)",
      }}
    >
      {selected ? <Check size={14} color={P} /> : null}
      <Text
        style={{
          color: selected ? "#fff" : "rgba(255,255,255,0.75)",
          fontSize: 14,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function WelcomeScreen() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const showToast = useUIStore((s) => s.showToast);
  const s = useWelcomeUiStore();
  const markStep = useOnboardingV2Store((st) => st.markStep);
  const setCurrentStep = useOnboardingV2Store((st) => st.setCurrentStep);

  const finish = () => {
    markStep("welcome", "done"); // login stops routing here
    setCurrentStep(null);
    onboardingCheckpoint("entry.complete");
    router.replace("/(protected)/(tabs)" as any);
  };

  // Prefill / self-skip from the profile row (may have been set on web).
  useEffect(() => {
    if (!user?.id) return;
    setCurrentStep("welcome");
    (async () => {
      try {
        const { data } = await supabase
          .from("users")
          .select("sexuality, event_audience")
          .eq("id", Number(user.id))
          .maybeSingle();
        if (data?.sexuality?.length) {
          updateUser({
            sexuality: data.sexuality,
            eventAudience: data.event_audience || undefined,
          });
          finish();
        }
      } catch {
        // Best-effort — the flow works from a blank slate.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const savePreferences = async () => {
    if (!s.identity.length && !s.audience) {
      s.setStep(2);
      return;
    }
    s.setSaving(true);
    try {
      await usersApi.updateProfile({
        ...(s.identity.length ? { sexuality: s.identity } : {}),
        ...(s.audience ? { eventAudience: s.audience } : {}),
      });
      updateUser({ sexuality: s.identity, eventAudience: s.audience || undefined });
      markStep("profile.identity", s.identity.length ? "done" : "skipped");
      s.setStep(2);
    } catch (err: any) {
      onboardingFailure("profile.identity_saved", err);
      showToast("error", "Couldn't save", err?.message || "Please try again.");
    }
    s.setSaving(false);
  };

  const enableLocation = async () => {
    s.setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        markStep("profile.location", "skipped");
        showToast("info", "Location off", "You can enable it anytime from Events.");
        s.setLocating(false);
        finish();
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      const { setDeviceLocation, setLocationMode, setActiveCity } =
        useEventsLocationStore.getState();
      setDeviceLocation(latitude, longitude);
      setLocationMode("device");
      const cities: City[] = await citiesApi.getCities();
      let nearest: City | null = null;
      let best = Infinity;
      for (const c of cities) {
        const d = (c.lat - latitude) ** 2 + (c.lng - longitude) ** 2;
        if (d < best) {
          best = d;
          nearest = c;
        }
      }
      if (nearest) setActiveCity(nearest);
      markStep("profile.location", "done");
      showToast(
        "success",
        "Location on",
        nearest ? `Showing events near ${nearest.name}` : "Showing events near you",
      );
    } catch (err: any) {
      onboardingFailure("profile.location_enabled", err);
    }
    s.setLocating(false);
    finish();
  };

  const steps = [
    {
      title: "I am…",
      subtitle:
        "Pick all that fit. Private — used only to tune your events and feed, never shown on your profile.",
      body: (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {IDENTITY_OPTIONS.map((label) => (
            <Chip
              key={label}
              label={label}
              selected={s.identity.includes(label)}
              onPress={() => s.toggleIdentity(label)}
            />
          ))}
        </View>
      ),
      primaryLabel: "Continue",
      onPrimary: () => s.setStep(1),
      skipLabel: "Skip",
      onSkip: () => s.setStep(1),
    },
    {
      title: "Looking for events with…",
      subtitle: "We’ll put these events first. You can change this anytime in settings.",
      body: (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {AUDIENCE_OPTIONS.map((label) => (
            <Chip
              key={label}
              label={label}
              selected={s.audience === label}
              onPress={() => s.setAudience(s.audience === label ? "" : label)}
            />
          ))}
        </View>
      ),
      primaryLabel: "Continue",
      onPrimary: savePreferences,
      skipLabel: "Skip",
      onSkip: savePreferences,
    },
    {
      title: "See what’s near you",
      subtitle:
        "Turn on location to see events happening around you — not everywhere. Only used while you browse.",
      body: (
        <View style={{ alignItems: "center", paddingVertical: 18 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(62,164,229,0.16)",
              borderWidth: 1,
              borderColor: "rgba(62,164,229,0.4)",
            }}
          >
            <MapPin size={32} color={P} />
          </View>
        </View>
      ),
      primaryLabel: "Enable location",
      onPrimary: enableLocation,
      skipLabel: "Not now",
      onSkip: () => {
        markStep("profile.location", "skipped");
        finish();
      },
    },
  ] as const;

  const current = steps[s.step] ?? steps[0];
  const busy = s.saving || s.locating;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#02030A" }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 480,
            alignSelf: "center",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            borderRadius: 12,
            backgroundColor: "rgba(255,255,255,0.06)",
            padding: 28,
          }}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.50)",
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            Welcome to DVNT
          </Text>
          <Text style={{ marginTop: 14, color: "#fff", fontSize: 32, lineHeight: 38, fontWeight: "900" }}>
            {current.title}
          </Text>
          <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 21 }}>
            {current.subtitle}
          </Text>

          <View style={{ marginTop: 24 }}>{current.body}</View>

          <View style={{ marginTop: 28, gap: 12 }}>
            <Pressable
              onPress={current.onPrimary}
              disabled={busy}
              accessibilityRole="button"
              style={{
                height: 48,
                borderRadius: 12,
                backgroundColor: P,
                alignItems: "center",
                justifyContent: "center",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
                  {current.primaryLabel}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={current.onSkip} disabled={busy} accessibilityRole="button">
              <Text
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 14,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {current.skipLabel}
              </Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 24 }}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === s.step ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === s.step ? "#FF5BFC" : "rgba(255,255,255,0.25)",
                }}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
