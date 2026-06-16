/**
 * LikesSheetController — Centralized Likes Sheet
 *
 * ARCHITECTURE:
 * - ONE BottomSheetModal instance, always mounted at app root
 * - Portals through BottomSheetModalProvider in _layout.tsx
 * - Controlled via useLikesSheet() context hook from ANY screen
 * - No conditional rendering, no ref timing race, no per-screen instances
 *
 * WHY:
 * Previous approach used per-screen <LikesSheet isOpen={...} /> with
 * useEffect → present(). This caused dead taps because:
 * 1. useEffect runs AFTER render (frame gap)
 * 2. Optional chaining (?.) silently swallows null refs
 * 3. FlatList cell recycling can stale the ref
 *
 * This controller eliminates all three failure modes.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetFlatList,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { X, Heart } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Avatar } from "@/components/ui/avatar";
import {
  usePostLikers,
  usePrefetchPostLikers,
} from "@/lib/hooks/use-post-likers";
import { useColorScheme } from "@/lib/hooks";
import type { PostLiker } from "@/lib/api/likes";
import { useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@/lib/prefetch";
import { SHEET_SNAPS } from "@/lib/constants/sheets";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Context ───────────────────────────────────────────────
interface LikesSheetContextValue {
  open: (postId: string) => void;
  close: () => void;
  prefetch: (postId: string) => void;
  activePostId: string | null;
}

const LikesSheetContext = createContext<LikesSheetContextValue>({
  open: () => {},
  close: () => {},
  prefetch: () => {},
  activePostId: null,
});

/**
 * useLikesSheet — call from ANY component to open/close the likes sheet.
 *
 * Usage:
 *   const { open, prefetch } = useLikesSheet();
 *   <Pressable onPressIn={() => prefetch(postId)} onPress={() => open(postId)}>
 */
export function useLikesSheet() {
  return useContext(LikesSheetContext);
}

// ─── Telemetry (DEV + Sentry breadcrumbs) ──────────────────
let _lastTapTimestamp = 0;
let _lastTapPostId = "";

function logTap(
  event: string,
  postId: string,
  extra?: Record<string, unknown>,
) {
  const ts = Date.now();
  if (__DEV__) {
    console.log(`[LikesSheet] ${event}`, { postId, ts, ...extra });
  }
  // Sentry breadcrumb (non-blocking, best-effort)
  try {
    const Sentry = require("@sentry/react-native");
    Sentry.addBreadcrumb({
      category: "likes-sheet",
      message: event,
      data: { postId, ts, ...extra },
      level: "info",
    });
  } catch {
    // Sentry not available — no-op
  }
  return ts;
}

// Dead-tap detector: if LIKES_TAP fires but no LIKES_SHEET_OPEN within 200ms
function scheduleDeadTapCheck(postId: string, tapTs: number) {
  if (!__DEV__) return;
  setTimeout(() => {
    if (_lastTapPostId === postId && _lastTapTimestamp === tapTs) {
      console.error(
        `[STOP-THE-LINE] Dead tap detected: LIKES_TAP fired for ${postId} ` +
          `at ${tapTs} but sheet did not open within 200ms`,
      );
    }
  }, 200);
}

// ─── LikerRow (pure, unchanged) ────────────────────────────
function formatLikedAt(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function LikerRow({
  liker,
  onPress,
}: {
  liker: PostLiker;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.likerRow}>
      <Avatar
        uri={liker.avatar}
        username={liker.username}
        size={44}
        variant="roundedSquare"
      />
      <View style={styles.likerInfo}>
        <Text style={styles.likerUsername} numberOfLines={1}>
          {liker.username}
        </Text>
        {liker.displayName !== liker.username && (
          <Text style={styles.likerDisplayName} numberOfLines={1}>
            {liker.displayName}
          </Text>
        )}
      </View>
      <Text style={styles.likerTime}>{formatLikedAt(liker.likedAt)}</Text>
    </Pressable>
  );
}

// ─── Sheet Content (rendered inside the always-mounted modal) ──
function LikesSheetContent({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();

  const { data: likers = [], isLoading } = usePostLikers(postId, !!postId);

  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      onClose();
      router.push(`/(protected)/profile/${username}` as any);
    },
    [router, onClose, queryClient],
  );

  const renderItem = useCallback(
    ({ item }: { item: PostLiker }) => (
      <LikerRow
        liker={item}
        onPress={() => handleProfilePress(item.username)}
      />
    ),
    [handleProfilePress],
  );

  const keyExtractor = useCallback(
    (item: PostLiker) => String(item.userId),
    [],
  );

  if (!postId) return null;

  return (
    <>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Heart size={18} color="#FF5BFC" fill="#FF5BFC" />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Likes
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <X size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.listContent}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.likerRow}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.08)",
                }}
              />
              <View style={[styles.likerInfo, { gap: 6 }]}>
                <View
                  style={{
                    width: 100,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                />
                <View
                  style={{
                    width: 70,
                    height: 12,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : likers.length === 0 ? (
        <View style={styles.centered}>
          <Heart size={32} color="rgba(255,255,255,0.2)" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No likes yet
          </Text>
        </View>
      ) : (
        <BottomSheetFlatList
          data={likers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </>
  );
}

// ─── Provider (mount ONCE at app root) ─────────────────────
export function LikesSheetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const modalRef = useRef<BottomSheetModal>(null);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const { colors } = useColorScheme();
  const snapPoints = useMemo(() => [...SHEET_SNAPS], []);
  const prefetchLikers = usePrefetchPostLikers();

  // Log mount for telemetry
  useEffect(() => {
    logTap("LIKES_SHEET_MOUNTED", "provider");
  }, []);

  const open = useCallback((postId: string) => {
    try {
      if (!postId) {
        console.warn("[LikesSheet] open() called with empty postId — ignoring");
        return;
      }

      logTap("LIKES_SHEET_OPEN_ATTEMPT", postId, {
        refExists: !!modalRef.current,
      });

      // Set postId FIRST so content renders with data
      setActivePostId(postId);

      // Present synchronously — ref is always valid because modal is always mounted
      if (modalRef.current) {
        modalRef.current.present();
        // Clear dead-tap detector
        _lastTapPostId = "";
        _lastTapTimestamp = 0;
        logTap("LIKES_SHEET_OPENED", postId);
      } else {
        // This should NEVER happen — modal is always mounted
        console.error(
          "[STOP-THE-LINE] LikesSheet modalRef is null despite always-mounted provider. " +
            "Check that LikesSheetProvider is inside BottomSheetModalProvider.",
        );
      }
    } catch (err) {
      // CRITICAL: open() must NEVER throw — an unhandled exception here
      // would propagate to the calling component's ErrorBoundary and show
      // the "Something went wrong" screen instead of opening the sheet.
      console.error("[LikesSheet] open() caught exception:", err);
    }
  }, []);

  const close = useCallback(() => {
    try {
      logTap("LIKES_SHEET_CLOSE", activePostId || "none");
      modalRef.current?.dismiss();
    } catch (err) {
      console.error("[LikesSheet] close() caught exception:", err);
    }
  }, [activePostId]);

  const prefetch = useCallback(
    (postId: string) => {
      prefetchLikers(postId);
    },
    [prefetchLikers],
  );

  const handleDismiss = useCallback(() => {
    setActivePostId(null);
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  // CRITICAL: Do NOT include activePostId in the memo deps.
  // Including it causes EVERY useLikesSheet() consumer to re-render when
  // the sheet opens/closes. On PostDetail, that re-render can hit stale data
  // and trigger the ErrorBoundary → "Something went wrong" screen.
  // Consumers only need open/close/prefetch — they never read activePostId.
  const contextValue = useMemo(
    () => ({ open, close, prefetch, activePostId: null as string | null }),
    [open, close, prefetch],
  );

  return (
    <LikesSheetContext.Provider value={contextValue}>
      {children}
      <BottomSheetModal
        ref={modalRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableOverDrag={false}
        enableDynamicSizing={false}
        onDismiss={handleDismiss}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: colors.card,
          borderRadius: 24,
        }}
        handleIndicatorStyle={{
          backgroundColor: colors.mutedForeground,
          width: 40,
        }}
        keyboardBehavior="interactive"
        android_keyboardInputMode="adjustResize"
        style={{ zIndex: 9999, elevation: 9999 }}
      >
        <LikesSheetContent postId={activePostId || ""} onClose={close} />
      </BottomSheetModal>
    </LikesSheetContext.Provider>
  );
}

// ─── Tap handler for Likes buttons (use everywhere) ────────
/**
 * Creates a standard onPress + onPressIn pair for likes buttons.
 * Guarantees: haptic + log + dead-tap detection + sheet open.
 *
 * Usage:
 *   const { open, prefetch } = useLikesSheet();
 *   <Pressable
 *     onPressIn={() => prefetch(postId)}
 *     onPress={() => {
 *       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
 *       open(postId);
 *     }}
 *   >
 */
export function fireLikesTap(
  postId: string,
  openSheet: (postId: string) => void,
) {
  try {
    // 1. Haptic FIRST (proves tap reached handler)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // 2. Telemetry
    const tapTs = logTap("LIKES_TAP", postId);
    _lastTapTimestamp = tapTs;
    _lastTapPostId = postId;

    // 3. Dead-tap detector
    scheduleDeadTapCheck(postId, tapTs);

    // 4. Open sheet SYNCHRONOUSLY
    openSheet(postId);
  } catch (err) {
    // CRITICAL: fireLikesTap must NEVER throw — the caller's ErrorBoundary
    // would catch it and show "Something went wrong" instead of the sheet.
    console.error("[LikesSheet] fireLikesTap caught exception:", err);
  }
}

// ─── Styles ────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  likerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  likerInfo: {
    flex: 1,
  },
  likerUsername: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  likerDisplayName: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    marginTop: 1,
  },
  likerTime: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 16,
  },
});
