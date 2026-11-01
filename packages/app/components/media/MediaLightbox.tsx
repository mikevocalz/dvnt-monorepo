/**
 * MediaLightbox — fullscreen image viewer, drop-in for @nandorojo/galeria.
 *
 * Why this exists:
 *   @nandorojo/galeria's native UIView gestureRecognizer doesn't fire on
 *   iOS 26 in current builds (confirmed taps don't open the lightbox).
 *   Until upstream Galeria ships an iOS 26 fix, this provides equivalent
 *   behaviour using stock JS-only components — no native dependency.
 *
 * Implementation:
 *   - @gorhom/bottom-sheet's BottomSheetModal (imperative, portaled, always
 *     mounted) — opens via ref.current.present(), no conditional render.
 *     This avoids the ref-not-ready race that bit a previous attempt using
 *     the declarative BottomSheet + requestAnimationFrame(snapToIndex).
 *   - Horizontal paged ScrollView for multi-image / mixed-media posts.
 *   - Shared media renderer preserves GIF / animated-video / Live Photo pairs.
 *   - Only the selected foreground page plays; the covered inline player pauses.
 *
 * Requirements:
 *   - <BottomSheetModalProvider> must be mounted somewhere above this in
 *     the React tree. app/_layout.tsx already mounts it at the root.
 *
 * API: matches Galeria so callers swap with `as Galeria`:
 *   <MediaLightbox urls={[...]}>            // string urls
 *   <MediaLightbox media={[...]}>            // typed media items (mixed image/gif)
 *     <MediaLightbox.Image index={i}>
 *       <YourThumbnail />
 *     </MediaLightbox.Image>
 *   </MediaLightbox>
 *
 * Tap on any <MediaLightbox.Image> opens the sheet at that index.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { DVNTMediaRenderer } from "./DVNTMediaRenderer";
import { useFeedPlaybackEnabled } from "../feed/feed-inline-video";
import type { MediaKind } from "@dvnt/app/lib/media/types";

type LightboxMedia = {
  type?: "image" | "gif" | "livePhoto" | string;
  url: string;
  livePhotoVideoUrl?: string;
  thumbnail?: string;
};

interface LightboxContextValue {
  items: LightboxMedia[];
  open: (index: number) => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

interface LightboxProps {
  /** Galeria-compatible: string urls (treated as images). */
  urls?: string[];
  /** Typed items preserve Live Photo pairs and animated media in the viewer. */
  media?: LightboxMedia[];
  /** Galeria-compat passthrough props (accepted but unused). */
  theme?: string;
  ids?: string[];
  closeIconName?: string;
  hideBlurOverlay?: boolean;
  hidePageIndicators?: boolean;
  children: React.ReactNode;
  /** Pause the covered inline player until the modal is fully dismissed. */
  onOpenChange?: (open: boolean) => void;
}

// Single snap point: full screen. Static reference so the array identity
// doesn't change between renders (BottomSheet recomputes snap layout on
// every new array, which can cause flicker on present).
const SNAP_POINTS = ["100%"] as const;

function LightboxProvider({ urls, media, children, onOpenChange }: LightboxProps) {
  const items: LightboxMedia[] = useMemo(() => {
    if (media && media.length) return media;
    return (urls ?? [])
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((url) => ({ type: "image" as const, url }));
  }, [urls, media]);

  const sheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [openIndex, setOpenIndex] = useState(0);
  const [initialIndex, setInitialIndex] = useState(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingScroll = useCallback(() => {
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    scrollTimer.current = null;
  }, []);
  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);
  const [isOpen, setIsOpen] = useState(false);
  const playbackEnabled = useFeedPlaybackEnabled();

  const screenWidth = Dimensions.get("window").width;
  // ScrollView page height must be explicit pixels — using "100%" collapses
  // to 0 because horizontal ScrollView doesn't propagate percentage heights
  // from a flex-1 parent through to its content children.
  const screenHeight = Dimensions.get("window").height;
  const initialOffset = useMemo(
    () => ({ x: initialIndex * screenWidth, y: 0 }),
    [initialIndex, screenWidth],
  );

  const open = useCallback(
    (index: number) => {
      if (!items.length) return;
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      cancelPendingScroll();
      setInitialIndex(clamped);
      setOpenIndex(clamped);
      setIsOpen(true);
      onOpenChange?.(true);
      // Present the modal sheet. ref is stable because the modal is
      // ALWAYS mounted (just hidden when not presented), so there is no
      // ref-not-ready race.
      sheetRef.current?.present();
      // Scroll to the tapped index *after* present so the ScrollView has
      // mounted dimensions. requestAnimationFrame on its own is too early
      // when the sheet is opening for the first time — use a short timeout
      // that runs after the open animation has begun rendering the children.
      scrollTimer.current = setTimeout(() => {
        scrollTimer.current = null;
        scrollRef.current?.scrollTo({
          x: clamped * screenWidth,
          y: 0,
          animated: false,
        });
      }, 80);
    },
    [items.length, screenWidth, onOpenChange, cancelPendingScroll],
  );

  const close = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const value = useMemo(() => ({ items, open }), [items, open]);

  return (
    <LightboxContext.Provider value={value}>
      {children}
      {/*
        Always mounted. Hidden when not presented. ref is stable across
        renders so consumers can call present()/dismiss() at any time.
        Portaled by BottomSheetModalProvider at the app root.
      */}
      <BottomSheetModal
        ref={sheetRef}
        onDismiss={() => {
          cancelPendingScroll();
          setIsOpen(false);
          onOpenChange?.(false);
        }}
        snapPoints={SNAP_POINTS as unknown as string[]}
        enablePanDownToClose
        enableOverDrag={false}
        handleComponent={null}
        backgroundStyle={styles.sheetBg}
        backdropComponent={renderBackdrop}
        style={styles.sheet}
      >
        <BottomSheetView style={styles.sheetContent}>
          <Pressable
            onPress={close}
            style={styles.closeBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close media viewer"
          >
            <X size={26} color="#fff" />
          </Pressable>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            contentOffset={initialOffset}
            onScroll={(event) => {
              if (screenWidth <= 0) return;
              setOpenIndex(Math.max(0, Math.min(items.length - 1, Math.round(
                event.nativeEvent.contentOffset.x / screenWidth,
              ))));
            }}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
          >
            {items.map((item, i) => (
              <View
                key={`${item.url}-${i}`}
                style={[
                  styles.page,
                  { width: screenWidth, height: screenHeight },
                ]}
              >
                <DVNTMediaRenderer
                  item={{ ...item, type: (item.type ?? "image") as MediaKind }}
                  width={screenWidth}
                  height={screenHeight}
                  contentFit="contain"
                  isPlaying={isOpen && playbackEnabled && i === openIndex}
                />
              </View>
            ))}
          </ScrollView>
        </BottomSheetView>
      </BottomSheetModal>
    </LightboxContext.Provider>
  );
}

interface LightboxImageProps {
  index: number;
  children: React.ReactElement;
  /** Optional contextual action on the same native press target as open. */
  onLongPress?: () => void;
  delayLongPress?: number;
  /** Galeria-compat passthrough props (ignored for now). */
  edgeToEdge?: boolean;
}

function LightboxImage({ index, children, onLongPress, delayLongPress }: LightboxImageProps) {
  const ctx = useContext(LightboxContext);
  const onPress = useCallback(() => ctx?.open(index), [ctx, index]);
  // Pressable wraps the visible thumbnail. Pressable's default onPress
  // fires synchronously on a tap-up event from the touch system — does
  // not depend on any native gestureRecognizer registered by a third-party
  // library, so iOS 26 doesn't break it.
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      accessibilityRole="button"
    >
      {children}
    </Pressable>
  );
}

// Galeria-compatible namespaced export: `<MediaLightbox.Image>`.
export const MediaLightbox = LightboxProvider as typeof LightboxProvider & {
  Image: typeof LightboxImage;
};
MediaLightbox.Image = LightboxImage;

const styles = StyleSheet.create({
  sheet: { zIndex: 10000, elevation: 10000 },
  sheetBg: { backgroundColor: "#000" },
  sheetContent: { flex: 1, backgroundColor: "#000" },
  closeBtn: {
    position: "absolute",
    top: 36,
    right: 16,
    zIndex: 100,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollView: { flex: 1 },
  scrollContent: { alignItems: "center" },
  page: { alignItems: "center", justifyContent: "center" },
});
