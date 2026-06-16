import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { View, Text, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Settings } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { TabHeaderLogo, TabHeaderRight } from "@dvnt/app/components/tab-header";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCallKeepCoordinator } from "@dvnt/app/src/services/callkeep";
import { NotificationListener } from "@dvnt/app/src/services/callkeep/NotificationListener";
import { usePresenceManager } from "@dvnt/app/lib/hooks/use-presence";
import {
  registerForPushNotificationsAsync,
  savePushTokenToBackend,
} from "@dvnt/app/lib/notifications";
import {
  registerVoipPushToken,
  saveVoipTokenToBackend,
} from "@dvnt/app/src/services/callkeep/voipPushService";
import { useBootPrefetch } from "@dvnt/app/lib/hooks/use-boot-prefetch";
import { useEventsFeedRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import { useAppResume } from "@dvnt/app/lib/hooks/use-app-resume";
import { useCartPaymentRecovery } from "@dvnt/app/lib/hooks/use-cart-payment-recovery";
import { useBootLocation } from "@dvnt/app/lib/hooks/use-boot-location";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { refreshWeather } from "@dvnt/app/src/features/weatherfx/WeatherDecisionEngine";
import { useWeatherFXStore } from "@dvnt/app/src/features/weatherfx/WeatherFXStore";
// import { WeatherGPUEngine } from "@dvnt/app/src/features/weatherfx/WeatherGPUEngine";
import { WeatherReanimatedOverlay } from "@dvnt/app/src/features/weatherfx/WeatherReanimatedOverlay";
import { useEventsTabVisibility } from "@dvnt/app/src/features/weatherfx/hooks/useEventsTabVisibility";
// import { isWebGPUAvailable } from "@dvnt/app/src/gpu/GpuRuntime";
import { useLiveSurface } from "@dvnt/app/src/live-surface";
import { useWatchTicketSync } from "@dvnt/app/src/watch/use-watch-ticket-sync";
import { useWatchBroadcastSync } from "@dvnt/app/src/watch/use-watch-broadcast-sync";
import { TransitionStack as Stack } from "@dvnt/app/lib/navigation/transition-stack";
import {
  dvntEventTransition,
  dvntPostTransition,
  dvntStoryTransition,
  dvntTicketTransition,
} from "@dvnt/app/lib/navigation/transition-options";
import { useMotionTier } from "@dvnt/app/lib/navigation/use-motion-tier";

const screenTransitionConfig = Platform.select({
  ios: {
    animation: "slide_from_right" as const,
    animationDuration: 250,
    gestureEnabled: true,
    gestureDirection: "horizontal" as const,
  },
  android: {
    animation: "fade_from_bottom" as const,
    animationDuration: 200,
  },
  default: {
    animation: "fade" as const,
    animationDuration: 200,
  },
});

const modalTransitionConfig = {
  presentation: "modal" as const,
  animation: "slide_from_bottom" as const,
  animationDuration: 300,
  gestureEnabled: true,
  gestureDirection: "vertical" as const,
};

const fullScreenModalConfig = {
  presentation: "fullScreenModal" as const,
  animation: "fade" as const,
  animationDuration: 250,
};

function TabsHeader() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { colors } = useColorScheme();
  const isProfile =
    pathname === "/profile" || pathname === "/(protected)/(tabs)/profile";
  const isCreate =
    pathname === "/create" || pathname === "/(protected)/(tabs)/create";
  const user = useAuthStore.getState().user;
  const router = useRouter();

  // Create screen renders its own header
  if (isCreate) return null;

  return (
    <View
      style={{
        backgroundColor: "#000",
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {isProfile ? (
        <Text
          style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}
        >
          @{user?.username || ""}
        </Text>
      ) : (
        <TabHeaderLogo />
      )}
      {isProfile ? (
        <Pressable
          onPress={() => router.push("/settings" as any)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Opens the settings screen"
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Settings size={24} color={colors.foreground} />
        </Pressable>
      ) : (
        <TabHeaderRight />
      )}
    </View>
  );
}

export default function ProtectedLayout() {
  const { colors } = useColorScheme();
  const motionTier = useMotionTier();
  // Initialize CallKeep native call UI — registers listeners ONCE
  useCallKeepCoordinator();
  // Track current user's online/offline presence
  usePresenceManager();
  // CRITICAL: Prefetch all critical data in parallel on app launch
  useBootPrefetch();
  // Silent background refresh on app resume (throttled 30s)
  useAppResume();
  useCartPaymentRecovery();
  // Silently resolve device location → nearest city on boot (if already permitted)
  useBootLocation();
  // Track Events tab focus → drives WeatherGPUEngine visibility + audio fade
  useEventsTabVisibility();
  // App-wide realtime UPDATE subscription on the events table — patches
  // every list cache in place when ANY event the user has loaded gets
  // edited (by them or by a co-organizer on another device). Mounted at
  // the layout level so feed cards, profile lists, and the events tab
  // all stay fresh without each screen needing its own subscription.
  useEventsFeedRealtime();
  // Mirror the member's tickets onto the Apple Watch (no-op off iOS). Reuses the
  // existing my-tickets poll as the source of truth — see docs/watch-app-fit.md.
  useWatchTicketSync();
  // Mirror host broadcasts onto the watch too (no-op off iOS). Reuses the existing
  // activity feed — no new pipeline. See docs/watch-broadcast-fit.md.
  useWatchBroadcastSync();

  const user = useAuthStore((s) => s.user);

  // ── Boot-level weather fetch: prime the store as soon as location is available ──
  const deviceLat = useEventsLocationStore(
    (s) => s.activeCity?.lat ?? s.deviceLat,
  );
  const deviceLng = useEventsLocationStore(
    (s) => s.activeCity?.lng ?? s.deviceLng,
  );

  // DVNT Live Surface — keeps iOS Live Activity + Home/Lock Screen widgets updated
  useLiveSurface({ lat: deviceLat ?? undefined, lng: deviceLng ?? undefined });
  const weatherCode = useWeatherFXStore((s) => s.weatherCode);

  useEffect(() => {
    if (deviceLat != null && deviceLng != null && weatherCode == null) {
      refreshWeather(deviceLat, deviceLng).catch(() => {});
    }
  }, [deviceLat, deviceLng, weatherCode]);

  // ── Register for push notifications on mount ────────────────────────
  // CRITICAL: This enables incoming calls to ring when app is backgrounded/killed
  useEffect(() => {
    if (!user?.id) return;

    const registerPush = async () => {
      try {
        const token = await registerForPushNotificationsAsync();
        if (token) {
          console.log("[ProtectedLayout] Push token registered:", token);
          await savePushTokenToBackend(token, user.id, user.username);
          console.log("[ProtectedLayout] Push token saved to backend");
        }
      } catch (error) {
        console.error("[ProtectedLayout] Push registration failed:", error);
      }
    };

    registerPush();

    // Register for iOS VoIP push tokens (separate from Expo push)
    // This enables the native CallKit UI when app is killed
    const unsubVoip = registerVoipPushToken(async (voipToken) => {
      try {
        await saveVoipTokenToBackend(voipToken, user.id);
        console.log("[ProtectedLayout] VoIP token saved to backend");
      } catch (error) {
        console.error("[ProtectedLayout] VoIP token save failed:", error);
      }
    });

    return () => {
      unsubVoip();
    };
  }, [user?.id, user?.username]);

  return (
    <>
      {/* CRITICAL: NotificationListener handles incoming call push notifications */}
      <NotificationListener />
      <Stack
        screenOptions={{
          headerShown: false,
          ...screenTransitionConfig,
          contentStyle: { backgroundColor: "#000" },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{
            animation: "none",
            headerShown: true,
            header: () => <TabsHeader />,
          }}
        />
        <Stack.Screen name="search" />
        <Stack.Screen name="messages" />
        <Stack.Screen name="messages/new" options={modalTransitionConfig} />
        <Stack.Screen
          name="messages/new-group"
          options={modalTransitionConfig}
        />
        <Stack.Screen
          name="post/[id]"
          options={({ route }) =>
            dvntPostTransition(
              String((route.params as any)?.id ?? ""),
              motionTier,
            )
          }
        />
        <Stack.Screen
          name="profile/[username]"
          options={{
            animation: "slide_from_right",
            animationDuration: 250,
          }}
        />
        <Stack.Screen name="profile/edit" options={modalTransitionConfig} />
        <Stack.Screen
          name="events/create"
          options={{ ...fullScreenModalConfig, headerShown: true }}
        />
        <Stack.Screen
          name="events/[id]"
          options={({ route }) =>
            dvntEventTransition(
              String((route.params as any)?.id ?? ""),
              motionTier,
            )
          }
        />
        <Stack.Screen name="checkout/review" options={modalTransitionConfig} />
        <Stack.Screen name="checkout/success" options={modalTransitionConfig} />
        <Stack.Screen
          name="story/[id]"
          options={({ route }) =>
            dvntStoryTransition(
              String((route.params as any)?.id ?? ""),
              motionTier,
            )
          }
        />
        <Stack.Screen
          name="ticket/[id]"
          options={({ route }) =>
            dvntTicketTransition(
              String((route.params as any)?.id ?? ""),
              motionTier,
            )
          }
        />
        <Stack.Screen
          name="story/create"
          options={{ ...fullScreenModalConfig, headerShown: true }}
        />
        <Stack.Screen
          name="story/editor"
          options={{ ...fullScreenModalConfig, animation: "fade" }}
        />
        <Stack.Screen name="crop-preview" options={{ headerShown: true }} />
        <Stack.Screen name="chat" />
        <Stack.Screen
          name="call"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
        <Stack.Screen
          name="comments"
          options={{
            headerShown: false,
            presentation: "transparentModal",
            animation: "slide_from_bottom",
            animationDuration: 250,
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen
          name="camera"
          options={{ ...fullScreenModalConfig, animation: "fade" }}
        />
      </Stack>
      {/* PERSISTENT: Weather overlay — renders ON TOP of screens.
          pointerEvents="none" — touches pass through to content below. */}
      <WeatherReanimatedOverlay />
      {/* WeatherGPUEngine disabled - requires react-native-wgpu native module */}
      {/* {isWebGPUAvailable() && <WeatherGPUEngine />} */}
    </>
  );
}
