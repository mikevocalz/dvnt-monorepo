import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { View, Text, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Settings, X } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { TabHeaderLogo, TabHeaderRight } from "@dvnt/app/components/tab-header";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCreateHeaderStore } from "@dvnt/app/lib/stores/create-header-store";
import { useCallKeepCoordinator } from "@dvnt/app/features/services/callkeep";
import { NotificationListener } from "@dvnt/app/features/services/callkeep/NotificationListener";
import { usePresenceManager } from "@dvnt/app/lib/hooks/use-presence";
import {
  registerForPushNotificationsAsync,
  savePushTokenToBackend,
  saveLiveActivityPushToStartToken,
} from "@dvnt/app/lib/notifications";
import { addLiveActivityPushToStartListener } from "@dvnt/app/features/live-surface";
import {
  registerVoipPushToken,
  saveVoipTokenToBackend,
} from "@dvnt/app/features/services/callkeep/voipPushService";
import { useBootPrefetch } from "@dvnt/app/lib/hooks/use-boot-prefetch";
import { useEventsFeedRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import { useAppResume } from "@dvnt/app/lib/hooks/use-app-resume";
import { useCartPaymentRecovery } from "@dvnt/app/lib/hooks/use-cart-payment-recovery";
import { useBootLocation } from "@dvnt/app/lib/hooks/use-boot-location";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { refreshWeather } from "@dvnt/app/features/weatherfx/WeatherDecisionEngine";
import { useWeatherFXStore } from "@dvnt/app/features/weatherfx/WeatherFXStore";
// import { WeatherGPUEngine } from "@dvnt/app/features/weatherfx/WeatherGPUEngine";
import { WeatherReanimatedOverlay } from "@dvnt/app/features/weatherfx/WeatherReanimatedOverlay";
import { IncomingCallOverlay } from "@dvnt/app/features/call/ui/incoming-call-overlay";
import { useEventsTabVisibility } from "@dvnt/app/features/weatherfx";
// import { isWebGPUAvailable } from "@dvnt/app/features/gpu/GpuRuntime";
import { useLiveSurface } from "@dvnt/app/features/live-surface";
import { useWatchTicketSync } from "@dvnt/app/features/watch/use-watch-ticket-sync";
import { useWatchBroadcastSync } from "@dvnt/app/features/watch/use-watch-broadcast-sync";
import { useWatchEvents, useWatchCalls } from "@dvnt/app/features/watch/use-watch-events";
import { useWatchDMSync } from "@dvnt/app/features/watch/use-watch-dm-sync";
import { TransitionStack as Stack } from "@dvnt/app/lib/navigation/transition-stack";
import {
  dvntEventTransition,
  dvntPostTransition,
  dvntStoryTransition,
  dvntTicketTransition,
} from "@dvnt/app/lib/navigation/transition-options";
import { useMotionTier } from "@dvnt/app/lib/navigation/use-motion-tier";
import { AppDrawerHost } from "@dvnt/app/features/navigation/app-drawer-host";
import { DrawerTrigger } from "@dvnt/app/components/drawer-trigger";
import { useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import {
  buildTicketLibrary,
  libraryCounts,
} from "@dvnt/app/lib/tickets/ticket-library";

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

/**
 * Fixed content height for the tab header row.
 *
 * The bar used to be sized by its tallest child, and the children differ per
 * tab — Profile's 44pt settings button, Create's Post pill, the icon pair
 * elsewhere — so the header changed height as you moved between tabs and the
 * screen under it jumped. Pinning the row makes the chrome stationary.
 */
const TAB_HEADER_ROW_HEIGHT = 44;

function TabsHeader() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { colors } = useColorScheme();
  const isProfile =
    pathname === "/profile" || pathname === "/(protected)/(tabs)/profile";
  const isCreate =
    pathname === "/create" || pathname === "/(protected)/(tabs)/create";
  const username = useAuthStore((st) => st.user?.username);
  const router = useRouter();

  // The drawer's dot reflects the one thing in there that is genuinely waiting
  // on the member: a transfer to accept, or issuance that has not landed.
  const tickets = useMyTickets();
  const attentionCount = libraryCounts(
    buildTicketLibrary(tickets.data ?? []),
  ).needsAttention;

  // Create's actions are screen state, so the screen publishes them here and
  // this slot draws them. It used to draw its own bar inside the screen, which
  // put the Create header BELOW the tab bar while every sibling's sat above it.
  const createCanPost = useCreateHeaderStore((s) => s.canPost);
  const createPostLabel = useCreateHeaderStore((s) => s.postLabel);
  const createOnClose = useCreateHeaderStore((s) => s.onClose);
  const createOnPost = useCreateHeaderStore((s) => s.onPost);

  if (isCreate) {
    return (
      <View
        style={{
          backgroundColor: "#000",
          paddingTop: insets.top,
          paddingHorizontal: 16,
          paddingBottom: 8,
          height: insets.top + TAB_HEADER_ROW_HEIGHT + 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {/* Equal-weight side slots so the mark is centred on the HEADER, not on
            whatever the controls happen to measure — the Post pill is far wider
            than the close glyph. */}
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <Pressable
            onPress={() => createOnClose?.()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>

        <TabHeaderLogo />

        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Pressable
            onPress={() => createOnPost?.()}
            disabled={!createCanPost}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={createPostLabel}
            accessibilityState={{ disabled: !createCanPost }}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: createCanPost
                ? "#3EA4E5"
                : "rgba(255,255,255,0.08)",
            }}
          >
            <Text
              style={{
                color: createCanPost ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 15,
                fontWeight: "700",
              }}
            >
              {createPostLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: "#000",
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 8,
        height: insets.top + TAB_HEADER_ROW_HEIGHT + 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Menu then mark. The trigger is visible on every top-level surface —
          a drawer you can only find by guessing at an edge swipe is a drawer
          most people never find. The mark keeps its scroll-to-top behaviour. */}
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <DrawerTrigger badge={attentionCount} />
        <TabHeaderLogo />
      </View>
      {/* Your own profile names itself in the title slot, the same way another
          member's profile does — otherwise the two screens show the same thing
          and only one of them says whose it is. Other tabs have no title: the
          selected tab already says where you are. */}
      {isProfile ? (
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          style={{
            color: colors.foreground,
            fontSize: 17,
            fontWeight: "600",
            flexShrink: 1,
            maxWidth: "55%",
            textAlign: "center",
          }}
        >
          {username ?? ""}
        </Text>
      ) : null}
      <View style={{ flex: 1, alignItems: "flex-end" }}>
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
  // Conversation previews on the wrist + relay a reply typed there back through
  // the phone's own send path. Opt-in — off until the member turns it on.
  useWatchDMSync();
  useWatchEvents();
  useWatchCalls();

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

    // Register the iOS Live Activity push-to-start token (expo-widgets) so the
    // server can start a Live Activity remotely while backgrounded.
    const unsubPushToStart = addLiveActivityPushToStartListener(
      (pushToStartToken) => {
        saveLiveActivityPushToStartToken(pushToStartToken).catch((error) => {
          console.error(
            "[ProtectedLayout] Live Activity push-to-start save failed:",
            error,
          );
        });
      },
    );

    return () => {
      unsubVoip();
      unsubPushToStart();
    };
  }, [user?.id, user?.username]);

  return (
    <>
      {/* CRITICAL: NotificationListener handles incoming call push notifications */}
      <NotificationListener />
      {/* The drawer wraps the Stack as a plain controlled component, so the
          Stack's element identity is stable across open/close. Opening the
          menu cannot remount the feed, reset scroll, or interrupt a call. */}
      <AppDrawerHost>
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
        {/* `ticket/` has its own _layout, so this stack's child is the GROUP
            `ticket`, not `ticket/[id]`. Naming the leaf meant expo-router
            matched nothing ("No route named ticket/[id] exists in nested
            children") and the shared-element transition never applied. */}
        <Stack.Screen
          name="ticket"
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
      </AppDrawerHost>
      {/* PERSISTENT: Weather overlay — renders ON TOP of screens.
          pointerEvents="none" — touches pass through to content below. */}
      <WeatherReanimatedOverlay />
      {/* PERSISTENT: incoming-call listener. Subscribes to call_signals and
          presents the accept/decline sheet over whatever is on screen.
          It also owns the WATCH call path — pushCallToWatch /
          registerWatchCallHandler are fired from inside it — so while this was
          unmounted, incoming calls rang on neither the phone nor the wrist. */}
      <IncomingCallOverlay />
      {/* WeatherGPUEngine disabled - requires react-native-wgpu native module */}
      {/* {isWebGPUAvailable() && <WeatherGPUEngine />} */}
    </>
  );
}
