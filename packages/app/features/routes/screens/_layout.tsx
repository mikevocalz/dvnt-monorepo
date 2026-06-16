import "../global.css";
// Install the global JS error handler FIRST — must be armed before
// any other side-effect import can throw. Captures uncaught JS
// errors + unhandled Promise rejections, persists to MMKV for the
// next session to surface. OTA-safe — pure JS.
import "@dvnt/app/lib/global-error-handler";
import "@dvnt/app/lib/query-focus-manager";
import "@dvnt/app/lib/i18n";
import "@dvnt/app/lib/ota-bootstrap-log";
// Reads + logs prior-session crashes from BOTH layers:
//   - JS errors persisted by global-error-handler (OTA-safe)
//   - Native NSExceptions persisted by the AppDelegate handler from
//     plugins/with-uncaught-exception-handler.js (requires native
//     rebuild — the file just won't exist on OTA-only builds)
import "@dvnt/app/lib/native-exception-log";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  initConnectivity,
  useConnectivityStore,
} from "@dvnt/app/lib/stores/connectivity-store";
import { OfflineBanner } from "@dvnt/app/components/offline-banner";
import {
  persistOptions,
  checkAndClearCacheOnOTAUpdate,
} from "@dvnt/app/lib/query-persistence";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import AnimatedSplashScreen from "@dvnt/app/components/animated-splash-screen";
import { Motion } from "@legendapp/motion";
import { PortalHost } from "@rn-primitives/portal";
import { ThemeProvider } from "@react-navigation/native";
import { Toaster } from "sonner-native";
import { ReportSheet } from "@dvnt/app/components/reports/report-sheet";
import { NAV_THEME } from "@dvnt/app/theme";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Platform,
  View,
  Pressable,
  Text,
  ActivityIndicator,
} from "react-native";
import { useUpdates } from "@dvnt/app/lib/hooks/use-updates";
import { useNotifications } from "@dvnt/app/lib/hooks/use-notifications";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { routeFromNotification } from "@dvnt/app/lib/notifications/notificationRouter";
import { setQueryClient } from "@dvnt/app/lib/auth-client";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { FeedSkeleton } from "@dvnt/app/components/skeletons";
import { enforceListPolicy } from "@dvnt/app/lib/guards/list-guard";
import { LikesSheetProvider } from "@dvnt/app/src/features/likes/LikesSheetController";
import * as ScreenOrientation from "expo-screen-orientation";
import { Dimensions } from "react-native";
import { BiometricLock } from "@dvnt/app/components/BiometricLock";
import { LayoutAnimationConfig } from "react-native-reanimated";
import { ShareIntentHandler } from "@dvnt/app/components/share-intent-handler";
import { SpotifyShareSheet } from "@dvnt/app/components/share/spotify-share-sheet";
import { SafeStripeProvider as StripeProvider } from "@dvnt/app/lib/safe-native-modules";
import {
  isSafeMode,
  markBootCompleted,
  getBootDiagnostics,
} from "@dvnt/app/lib/boot-guard";
import { SafeModeBanner } from "@dvnt/app/components/safe-mode-banner";
import { PublicGateSheet } from "@dvnt/app/components/access/PublicGateSheet";
import { DeviceTestBridge } from "@dvnt/app/components/dev/DeviceTestBridge";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import { OtaUpdateBanner } from "@dvnt/app/components/ota/OtaUpdateBanner";
import { OtaRecoveryBoundary } from "@dvnt/app/components/system/OtaRecoveryBoundary";
import { confirmUpdateSuccess } from "@dvnt/app/lib/ota/updateSafety";
import { captureOtaDiagnostics, logDiagnostics } from "@dvnt/app/lib/ota/otaDiagnostics";

// CRITICAL: Check for OTA update and clear stale cache BEFORE creating QueryClient
// This prevents crashes from incompatible persisted cache after OTA updates
checkAndClearCacheOnOTAUpdate();

// DEV-only: Enforce LegendList-only policy on app boot
enforceListPolicy();

SplashScreen.preventAutoHideAsync();

// Supabase URL for health checks
const _rawLayoutUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL =
  typeof _rawLayoutUrl === "string" && _rawLayoutUrl.startsWith("https://")
    ? _rawLayoutUrl
    : "https://npfjanxturvmjyevoyfo.supabase.co";

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  DEVIANT QUERY POLICY — Social-app-tuned QueryClient       ║
 * ║                                                              ║
 * ║  Render from cache first, revalidate silently in background. ║
 * ║  Navigation must NEVER block on network.                     ║
 * ║  See: .windsurf/workflows/no-waterfall-rules.md              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — cache is "fresh" this long
      gcTime: 30 * 60 * 1000, // 30 min — keep unused cache in memory
      refetchOnMount: false, // render from cache, never block navigation
      refetchOnWindowFocus: false, // no flicker on app resume
      refetchOnReconnect: true, // revalidate after network recovery
      retry: 1, // single retry on failure
      structuralSharing: true, // prevent unnecessary re-renders
    },
    mutations: {
      retry: 0, // mutations never auto-retry
    },
  },
});

// Register query client with auth module so it can clear cache on user switch
setQueryClient(queryClient);

// ─── Connectivity wiring ───────────────────────────────────────────────────
// Module-scope init so exactly ONE network listener is attached for the
// whole app lifetime. initConnectivity() is idempotent — safe if this
// module reloads during dev.
//
// CRITICAL: this block runs at module-eval time, BEFORE React mounts.
// A throw here takes down the entire app bundle (the exact OTA crash
// pattern we hit in prod). Everything is defensive — if connectivity
// wiring fails, we continue with the optimistic-online seed and React
// Query's onlineManager default. No user-visible impact beyond losing
// the offline banner and mutation pause-on-offline behavior.
try {
  initConnectivity();
} catch (e) {
  console.warn("[Boot] initConnectivity failed (non-fatal):", e);
}

// Bridge the Zustand connectivity phase to React Query's onlineManager.
// Same defensive envelope as above — a failure here must not crash boot.
try {
  onlineManager.setEventListener((setOnline) => {
    setOnline(useConnectivityStore.getState().phase !== "offline");
    const unsub = useConnectivityStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        setOnline(state.phase !== "offline");
      }
    });
    return unsub;
  });
} catch (e) {
  console.warn("[Boot] onlineManager wiring failed (non-fatal):", e);
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const loadAuthState = useAuthStore((s) => s.loadAuthState);
  const authStatus = useAuthStore((s) => s.authStatus);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasSeenOnboarding = useAuthStore((s) => s.hasSeenOnboarding);
  const userId = useAuthStore((s) => s.user?.id);
  // Root-layout wraps the whole app. Destructuring the store here
  // re-rendered every descendant whenever ANY app-store field updated
  // (pendingShareIntentRoute, nsfwEnabled, feedMode…). Narrow selectors
  // scope re-renders to this one layout.
  const appReady = useAppStore((s) => s.appReady);
  const splashAnimationFinished = useAppStore(
    (s) => s.splashAnimationFinished,
  );
  const setAppReady = useAppStore((s) => s.setAppReady);
  const onAnimationFinish = useAppStore((s) => s.onAnimationFinish);
  const setSplashAnimationFinished = useAppStore(
    (s) => s.setSplashAnimationFinished,
  );
  const insets = useSafeAreaInsets();
  const openedFromShareIntent = useDeepLinkStore(
    (s) => s.openedFromShareIntent,
  );
  const pendingShareIntentRoute = useAppStore((s) => s.pendingShareIntentRoute);
  const shareIntentReady = useAppStore((s) => s.shareIntentReady);
  const setShareIntentReady = useAppStore((s) => s.setShareIntentReady);

  useEffect(() => {
    const delay = openedFromShareIntent ? 0 : 1500;
    const t = setTimeout(() => setShareIntentReady(true), delay);
    return () => clearTimeout(t);
  }, [openedFromShareIntent]);

  // NOTE: We do NOT reset splashAnimationFinished here.
  // Once the splash animation is finished, it should never replay during the app session.
  // The splashAnimationFinished state is initialized to false in the store,
  // and is set to true when the animation completes via onAnimationFinish.

  // Check for OTA updates AFTER splash completes (not before)
  // This prevents update checks from interfering with splash animation
  // and ensures updates work correctly in production builds
  useUpdates({ enabled: splashAnimationFinished });

  // ── Boot Guard: mark boot completed when app is fully up ─────────
  useEffect(() => {
    if (splashAnimationFinished && authStatus !== "loading") {
      markBootCompleted();
      // Confirm OTA update succeeded (clears pending marker, prevents crash-loop blacklisting)
      try {
        const Updates = require("expo-updates");
        const runningUpdateId = Updates?.updateId ?? null;
        confirmUpdateSuccess(runningUpdateId);
        const diag = captureOtaDiagnostics();
        logDiagnostics(diag);
      } catch {}
      AppTrace.trace("BOOT", "boot_completed", {
        authStatus,
        isAuthenticated,
        safeMode: isSafeMode(),
      });
      if (isSafeMode()) {
        console.warn(
          "[RootLayout] Boot completed in SAFE MODE",
          getBootDiagnostics(),
        );
      }
    }
  }, [splashAnimationFinished, authStatus, isAuthenticated]);

  useEffect(() => {
    AppTrace.setContext({
      authStatus,
      isAuthenticated,
      userId,
    });
  }, [authStatus, isAuthenticated, userId]);

  useEffect(() => {
    if (authStatus === "loading") return;
    AppTrace.trace("AUTH", "auth_state_resolved", {
      authStatus,
      isAuthenticated,
      hasSeenOnboarding,
      hasUser: Boolean(userId),
    });
  }, [authStatus, hasSeenOnboarding, isAuthenticated, userId]);

  // Supabase JWT bridge — fire-and-forget, additive only. When auth
  // resolves with a signed-in user, mint a Supabase access-token so
  // PostgREST sees us as `authenticated` with the correct `sub`. If
  // minting fails (bridge disabled, network blip, missing secret),
  // the client silently keeps using the anon key — current behavior.
  // Never blocks the auth flow.
  useEffect(() => {
    if (authStatus === "loading") return;
    if (!isAuthenticated) return;
    (async () => {
      try {
        const { ensureSupabaseJwt } = await import("@dvnt/app/lib/auth/supabase-jwt");
        await ensureSupabaseJwt();
      } catch {
        // bridge is additive — failures are silent
      }
    })();
  }, [authStatus, isAuthenticated, userId]);

  // ── Share Intent — receive content from other apps ──────────────────
  // Initialize push notifications
  useNotifications();

  // Device-aware screen orientation (deferred to after mount — native module must be ready)
  useEffect(() => {
    const run = async () => {
      try {
        const { width } = Dimensions.get("window");
        const tablet = width >= 768;
        if (!tablet) {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP,
          );
        } else {
          await ScreenOrientation.unlockAsync();
        }
      } catch (e) {
        console.warn("[RootLayout] ScreenOrientation init failed:", e);
      }
    };
    run();
  }, []);

  // ── Cold-start notification check ──────────────────────────────────
  // If the app was launched by tapping a notification, skip splash
  // and queue the route for navigation after auth settles.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (splashAnimationFinished) return; // Already past splash
    let Notifications: typeof import("expo-notifications") | null = null;
    try {
      Notifications = require("expo-notifications");
    } catch {
      return;
    }
    if (!Notifications) return;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (!data?.type) return;

      console.log("[RootLayout] Cold start from notification:", data.type);

      // Central router resolves url > deepLink > typed fields
      const route = routeFromNotification(data);

      // Skip splash for ANY notification tap — user expects immediate content
      const store = useAppStore.getState();
      store.setSplashAnimationFinished(true);
      if (route) {
        store.setPendingNotificationRoute(route);
      }
      console.log(
        "[RootLayout] Splash skipped for notification:",
        data.type,
        route,
      );
    });
  }, [splashAnimationFinished]);

  const [fontsLoaded, fontError] = useFonts({
    "Inter-Regular": require("../assets/fonts/Inter-Regular.ttf"),
    "Inter-SemiBold": require("../assets/fonts/Inter-SemiBold.ttf"),
    "Inter-Bold": require("../assets/fonts/Inter-Bold.ttf"),
    "SpaceGrotesk-Regular": require("../assets/fonts/SpaceGrotesk-Regular.ttf"),
    "SpaceGrotesk-SemiBold": require("../assets/fonts/SpaceGrotesk-SemiBold.ttf"),
    "SpaceGrotesk-Bold": require("../assets/fonts/SpaceGrotesk-Bold.ttf"),
    "Republica-Minor": require("../assets/fonts/Republica-Minor.ttf"),
    BraveGates: require("../assets/fonts/BraveGates.ttf"),
    LightBrighter: require("../assets/fonts/LightBrighter.ttf"),
    Oasis: require("../assets/fonts/oasis.ttf"),
    RedHat: require("../assets/fonts/redhat.ttf"),
  });

  // ── Auth initialization — runs ONCE on mount ──────────────────────────
  // CRITICAL: No double-call, no 500ms retry. loadAuthState sets authStatus
  // to 'loading' at the start and transitions to 'authenticated' or
  // 'unauthenticated' exactly once when it completes.
  useEffect(() => {
    // Health check (fire-and-forget, never blocks boot)
    fetch(`${SUPABASE_URL}/rest/v1/users?limit=1`, {
      headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "" },
    })
      .then((res) => {
        console.log("[RootLayout] Supabase Health OK - Status:", res.status);
        AppTrace.trace("BOOT", "supabase_health_ok", { status: res.status });
      })
      .catch((err) => {
        console.error("[RootLayout] Supabase Health FAIL:", err);
        AppTrace.error("BOOT", "supabase_health_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Load auth state — single call, no retry loop
    AppTrace.trace("AUTH", "auth_load_started");
    loadAuthState();
  }, [loadAuthState]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      setAppReady(true);
    }
  }, [fontsLoaded, fontError, setAppReady]);

  // Hide native splash as soon as app is ready so the Rive animated splash is visible.
  // If we waited until splashAnimationFinished, the native splash would stay on top
  // and cover the Rive animation the entire time.
  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync();
    }
  }, [appReady]);

  // ── BOOT GATE ─────────────────────────────────────────────────────────
  const authSettled = authStatus !== "loading";

  // Skip splash when opening from share intent — get to ShareIntentHandler faster
  useEffect(() => {
    if (openedFromShareIntent && !splashAnimationFinished) {
      onAnimationFinish(false);
    }
  }, [openedFromShareIntent, splashAnimationFinished, onAnimationFinish]);

  // ── Auth-group routing guard ──────────────────────────────────────────
  // SDK 56's expo-router (4.0.22) doesn't expose Stack.Protected. If an
  // unauthenticated user lands on a (protected) route — including via deep
  // link — bounce to login. If an authenticated user lands on (auth), forward
  // to the tabs root. (public) is intentionally accessible in both states.
  const segments = useSegments();
  useEffect(() => {
    if (!authSettled) return;
    const top = segments[0] as string | undefined;
    if (!isAuthenticated && top === "(protected)") {
      router.replace("/(auth)/login");
    } else if (isAuthenticated && top === "(auth)") {
      router.replace("/(protected)/(tabs)");
    }
  }, [isAuthenticated, authSettled, segments]);

  // ── Execute queued notification route ─────────────────────────────────
  // After splash is done + auth settled + authenticated, navigate to the
  // route that was queued from a cold-start notification tap.
  useEffect(() => {
    if (!splashAnimationFinished || !authSettled || !isAuthenticated) return;
    const route = useAppStore.getState().consumePendingNotificationRoute();
    if (route) {
      // Small delay to ensure Stack is fully mounted
      setTimeout(() => {
        console.log("[RootLayout] Executing queued notification route:", route);
        router.push(route as any);
      }, 100);
    }
  }, [splashAnimationFinished, authSettled, isAuthenticated]);

  // ── Execute queued share-intent route ────────────────────────────────
  // Share intents arrive during boot via ShareIntentHandler. Queue the
  // destination until the protected stack is mounted, then push once.
  useEffect(() => {
    if (
      !splashAnimationFinished ||
      !authSettled ||
      !isAuthenticated ||
      !pendingShareIntentRoute
    ) {
      return;
    }

    const route = useAppStore.getState().consumePendingShareIntentRoute();
    if (route) {
      setTimeout(() => {
        console.log("[RootLayout] Executing queued share route:", route);
        router.push(route as any);
      }, 100);
    }
  }, [
    authSettled,
    isAuthenticated,
    pendingShareIntentRoute,
    splashAnimationFinished,
  ]);

  // ── Replay pending deep link after auth settles ──────────────────────
  // +native-intent.tsx may fire before Zustand rehydrates, causing it to
  // treat an already-authenticated user as a guest and save the link as
  // pending. Once splash is done + auth settled + user is authenticated,
  // replay any saved deep link so the user lands on the intended screen.
  useEffect(() => {
    if (!splashAnimationFinished || !authSettled || !isAuthenticated) return;
    const pending = useDeepLinkStore.getState().consumePendingLink();
    if (!pending) return;
    setTimeout(() => {
      console.log("[RootLayout] Replaying pending deep link:", pending.routerPath);
      router.push(pending.routerPath as any);
    }, 150);
  }, [splashAnimationFinished, authSettled, isAuthenticated]);

  // Show animated splash until BOTH app is ready AND animation is finished
  // IMPORTANT: Always wait for splashAnimationFinished, even if appReady is true
  const showAnimatedSplash = !splashAnimationFinished;

  if (showAnimatedSplash) {
    // No Reanimated wrapper here — worklets runtime races with first Fabric commit on OTA
    return (
      <ErrorBoundary
        screenName="Splash"
        fallback={
          <View
            style={{
              flex: 1,
              backgroundColor: "#000",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Pressable
              onPress={() => onAnimationFinish(false)}
              style={{ padding: 24 }}
            >
              <Text style={{ color: "#fff", fontSize: 16 }}>
                Tap to continue
              </Text>
            </Pressable>
          </View>
        }
      >
        <AnimatedSplashScreen onAnimationFinish={onAnimationFinish} />
      </ErrorBoundary>
    );
  }

  return (
    <OtaRecoveryBoundary>
    <ErrorBoundary
      screenName="App"
      onError={(error, errorInfo) => {
        console.error("[RootLayout] Global crash caught:", error.message);
      }}
    >
      <GestureHandlerRootView
        style={{
          flex: 1,
          height: "100%",
          width: "100%",
          backgroundColor: "#000",
        }}
      >
        <LayoutAnimationConfig skipEntering={false} skipExiting={false}>
          <BottomSheetModalProvider>
            <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
              <StripeProvider
                publishableKey={
                  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
                }
                merchantIdentifier="merchant.com.dvnt.app"
              >
                <PersistQueryClientProvider
                  client={queryClient}
                  persistOptions={persistOptions}
                >
                  <ThemeProvider
                    value={NAV_THEME[colorScheme === "light" ? "light" : "dark"]}
                  >
                    <LikesSheetProvider>
                      <View
                        style={{
                          flex: 1,
                          paddingBottom:
                            Platform.OS === "android" ? insets.bottom : 0,
                        }}
                      >
                        <StatusBar style="light" animated />
                        {/* CRITICAL: Stack is ALWAYS mounted — never conditionally unmount
                    the navigation tree. Unmounting destroys the NavigationContainer
                    and causes stale header references after OTA reload.
                    Auth gating is enforced inside (auth)/_layout and (protected)/_layout
                    via redirects on the unauthenticated/authenticated state. */}
                        <Stack
                          screenOptions={{
                            headerShown: false,
                            animation: "fade",
                            animationDuration: 100,
                            contentStyle: { backgroundColor: "#000" },
                          }}
                        >
                          {/* SDK 56's expo-router (4.0.22) doesn't expose Stack.Protected.
                              Auth gating happens in the useSegments-redirect effect above. */}
                          <Stack.Screen
                            name="(auth)"
                            options={{ animation: "none" }}
                          />
                          <Stack.Screen
                            name="(public)"
                            options={{ animation: "none" }}
                          />
                          <Stack.Screen
                            name="(protected)"
                            options={{ animation: "none" }}
                          />
                          <Stack.Screen
                            name="settings"
                            options={{
                              headerShown: false,
                              presentation: "fullScreenModal",
                              animation: "slide_from_bottom",
                              animationDuration: 300,
                              gestureEnabled: true,
                              gestureDirection: "vertical",
                            }}
                          />
                        </Stack>
                        {/* Share intent — deferred 4s after main app (expo-share-intent SDK 55/RN 0.84 crash workaround) */}
                        {shareIntentReady && (
                          <ErrorBoundary
                            screenName="ShareIntent"
                            fallback={null}
                          >
                            <ShareIntentHandler />
                          </ErrorBoundary>
                        )}
                        {/* BiometricLock renders ONLY after auth is settled + authenticated. */}
                        {isAuthenticated && <BiometricLock />}
                        {/* Safe Mode Banner — shown when boot guard detects crash loop */}
                        {isSafeMode() && <SafeModeBanner />}
                        {__DEV__ && <DeviceTestBridge />}
                        <PublicGateSheet />
                        {/* Spotify share sheet — renders when a Spotify link is received */}
                        <SpotifyShareSheet />
                        {/* OtaUpdateBanner — deterministic, fully unmounts when dismissed */}
                        <OtaUpdateBanner />
                        {/* Auth loading overlay — covers content but does NOT unmount navigation.
                          Skip when opened from share intent so user sees content instead of black. */}
                        {!authSettled &&
                          !openedFromShareIntent &&
                          !isAuthenticated && (
                            <View
                              style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: "#000",
                                zIndex: 10000,
                              }}
                              pointerEvents="auto"
                            >
                              {userId ? (
                                <FeedSkeleton />
                              ) : (
                                <View
                                  style={{
                                    flex: 1,
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <ActivityIndicator
                                    size="small"
                                    color="#3FDCFF"
                                  />
                                </View>
                              )}
                            </View>
                          )}
                      </View>
                      <PortalHost />
                      {/* Global UGC report sheet — driven by useReportSheetStore.
                          Mounted at root so any screen can call openReportSheet
                          without per-screen modal plumbing. Apple Guideline 1.2. */}
                      <ReportSheet />
                      {/* CRITICAL: pointerEvents box-none ensures toasts never block
                  touches on the navigation header underneath. Position bottom
                  to avoid header area entirely. */}
                      <View
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                        }}
                        pointerEvents="box-none"
                      >
                        <Toaster
                          position="bottom-center"
                          offset={80}
                          theme="dark"
                          toastOptions={{
                            style: {
                              backgroundColor: "#1a1a1a",
                              borderColor: "#333",
                              borderWidth: 1,
                            },
                            titleStyle: { color: "#fff" },
                            descriptionStyle: { color: "#a1a1aa" },
                          }}
                        />
                        {/* Global offline indicator. Mounted here so it
                            sits above every stack screen but BELOW the
                            toaster (so it doesn't block toast taps).
                            Driven by the flap-debounced connectivity
                            store so it never appears for brief dips. */}
                        <OfflineBanner />
                      </View>
                    </LikesSheetProvider>
                  </ThemeProvider>
                </PersistQueryClientProvider>
              </StripeProvider>
            </KeyboardProvider>
          </BottomSheetModalProvider>
        </LayoutAnimationConfig>
      </GestureHandlerRootView>
    </ErrorBoundary>
    </OtaRecoveryBoundary>
  );
}
