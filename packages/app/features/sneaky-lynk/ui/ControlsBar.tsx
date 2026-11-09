import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, Text, Pressable, Animated, Easing, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Flag,
  Hand,
  Heart,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  RotateCcw,
  Share2,
  Video,
  VideoOff,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import {
  DVNTLiquidGlass,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import Reanimated, { FadeInRight, FadeOutRight, useReducedMotion } from "react-native-reanimated";
import { controlsLayout } from "./controls-layout";
import type { RoomReaction } from "../hooks/useRoomReactions";

/**
 * The room's reaction palette. Exported because the GPU overlay rasterizes its
 * atlas from exactly this list, in this order — if the two ever drift, taps
 * render the wrong glyph.
 */
export const REACTION_EMOJIS = ["😂", "😢", "😊", "😈", "🥵", "💝"];

interface ControlsBarProps {
  disabled?: boolean;
  isLeaving?: boolean;
  isMuted: boolean;
  /** The host is holding this participant muted (lib/video/host-mute). The
   *  control still renders — hiding it would leave someone wondering where
   *  their microphone went — but it says who is holding it and why pressing
   *  does nothing. */
  hostMuteLocked?: boolean;
  isVideoEnabled: boolean;
  handRaised: boolean;
  hasVideo: boolean;
  localRole:
    | "host"
    | "co-host"
    | "moderator"
    | "speaker"
    | "participant"
    | "listener";
  overlayOpen?: boolean;
  floatingReactions?: RoomReaction[];
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleHand: () => void;
  onOpenChat: () => void;
  onShare?: () => void;
  onSwitchCamera?: () => void;
  onSendReaction?: (emoji: string) => void;
  onReport?: () => void;
}

function FloatingReaction({
  reaction,
  onComplete,
}: {
  reaction: RoomReaction;
  onComplete: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.72)).current;
  const drift = useRef(
    new Animated.Value(
      reaction.isOwn ? -18 - Math.random() * 22 : 18 + Math.random() * 22,
    ),
  ).current;

  // Starting the animation inside a `useRef` initializer ran it during render —
  // a side effect React is free to invoke twice (StrictMode, and any render
  // that gets thrown away), which double-fired `onComplete`. Effect, once.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (reduceMotion) {
      const timer = setTimeout(() => onCompleteRef.current(), 1600);
      return () => clearTimeout(timer);
    }
    const animation = Animated.parallel([
      Animated.timing(translateY, {
        toValue: -196 - Math.random() * 72,
        duration: 2200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.08,
          useNativeDriver: true,
          speed: 18,
          bounciness: 8,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 2200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start(() => onCompleteRef.current());
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 122,
        [reaction.isOwn ? "right" : "left"]: 28,
        opacity,
        transform: [{ translateY }, { translateX: drift }, { scale }],
      }}
    >
      <View
        style={{
          alignSelf: reaction.isOwn ? "flex-end" : "flex-start",
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.16)",
          backgroundColor: "rgba(4, 8, 16, 0.76)",
          paddingHorizontal: 10,
          paddingVertical: 5,
          marginBottom: 8,
        }}
      >
        <Text
          style={{
            color: "rgba(255,255,255,0.74)",
            fontSize: 11,
            fontWeight: "700",
          }}
          numberOfLines={1}
        >
          {reaction.senderLabel}
        </Text>
      </View>
      <Text style={{ fontSize: 34 }}>{reaction.emoji}</Text>
    </Animated.View>
  );
}

function ControlButton({
  icon,
  label,
  displayLabel,
  onPress,
  active = false,
  danger = false,
  compact = false,
  showLabel = true,
  diameter,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  displayLabel?: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  compact?: boolean;
  showLabel?: boolean;
  diameter?: number;
  disabled?: boolean;
}) {
  const size = Math.max(44, diameter ?? (compact ? 44 : 52));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({ width: size, minHeight: size + (showLabel ? 22 : 0), alignItems: "center", gap: 6, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 })}
    >
      <View style={{ width: size, height: size, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: danger ? "rgba(252,37,58,0.35)" : active ? "rgba(63,220,255,0.24)" : "rgba(255,255,255,0.10)", backgroundColor: danger ? "rgba(252,37,58,0.14)" : active ? "rgba(63,220,255,0.10)" : "rgba(255,255,255,0.04)" }}>
        {icon}
      </View>
      {showLabel ? <Text numberOfLines={1} style={{ color: danger ? "#FF9CA8" : active ? "#E3FAFF" : "#B7B9C5", fontSize: 11, fontWeight: "600" }}>{displayLabel ?? label}</Text> : null}
    </Pressable>
  );
}

export function ControlsBar({
  disabled = false,
  isLeaving = false,
  isMuted,
  hostMuteLocked = false,
  isVideoEnabled,
  handRaised,
  hasVideo,
  localRole,
  overlayOpen = false,
  floatingReactions = [],
  onLeave,
  onToggleMute,
  onToggleVideo,
  onToggleHand,
  onOpenChat,
  onShare,
  onSwitchCamera,
  onSendReaction,
  onReport,
}: ControlsBarProps) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const dock = controlsLayout(width, insets.left, insets.right, hasVideo ? 5 : 4);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const dockVisibility = useRef(
    new Animated.Value(overlayOpen ? 0 : 1),
  ).current;

  useEffect(() => {
    if (overlayOpen) {
      setShowEmojiPicker(false);
    }

    Animated.timing(dockVisibility, {
      toValue: overlayOpen ? 0 : 1,
      duration: reduceMotion ? 0 : overlayOpen ? 140 : 180,
      easing: overlayOpen ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [dockVisibility, overlayOpen, reduceMotion]);

  const controlsTranslateY = dockVisibility.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });
  const canRaiseHand = localRole === "participant" || localRole === "listener";

  const quickActions = useMemo(
    () =>
      [
        hasVideo && isVideoEnabled && onSwitchCamera
          ? {
              key: "flip",
              label: "Flip camera",
              displayLabel: "Flip",
              onPress: onSwitchCamera,
              icon: <RotateCcw size={18} color="#E2F2FF" />,
            }
          : null,
        canRaiseHand
          ? {
              key: "hand",
              label: handRaised ? "Lower hand" : "Raise hand",
              displayLabel: handRaised ? "Hand up" : "Hand",
              onPress: onToggleHand,
              icon: (
                <Hand size={18} color={handRaised ? "#FBBF24" : "#F8FAFC"} />
              ),
              active: handRaised,
            }
          : null,
        onReport
          ? { key: "report", label: "Report", onPress: onReport, icon: <Flag size={18} color="rgba(255,255,255,0.72)" /> }
          : null,
        onShare
          ? {
              key: "share",
              label: "Invite",
              onPress: onShare,
              icon: <Share2 size={18} color="#F8FAFC" />,
            }
          : null,
      ].filter(Boolean) as Array<{
        key: string;
        label: string;
        displayLabel?: string;
        onPress: () => void;
        icon: ReactNode;
        active?: boolean;
      }>,
    [
      canRaiseHand,
      hasVideo,
      isVideoEnabled,
      onSwitchCamera,
      onToggleHand,
      handRaised,
      onShare,
      onReport,
    ],
  );

  return (
    <Animated.View
      pointerEvents={overlayOpen ? "none" : "box-none"}
      accessibilityElementsHidden={overlayOpen}
      importantForAccessibility={overlayOpen ? "no-hide-descendants" : "yes"}
      style={{
        flexShrink: 0,
        paddingTop: 8,
        paddingBottom: insets.bottom + 10,
        paddingLeft: insets.left + dock.sidePadding,
        paddingRight: insets.right + dock.sidePadding,
        zIndex: overlayOpen ? 0 : 60,
        elevation: overlayOpen ? 0 : 60,
        opacity: dockVisibility,
        transform: [{ translateY: controlsTranslateY }],
      }}
    >
      {floatingReactions.map((reaction) => (
        <FloatingReaction
          key={reaction.id}
          reaction={reaction}
          onComplete={() => {}}
        />
      ))}

      {showEmojiPicker && (
        <Reanimated.View
          pointerEvents="box-none"
          entering={FadeInRight.springify().damping(18).stiffness(220)}
          exiting={FadeOutRight.duration(180)}
          style={{
            position: "absolute",
            bottom: "100%",
            left: insets.left + 8,
            right: insets.right + 8,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <DVNTLiquidGlass
            radius={18}
            paddingH={8}
            paddingV={8}
            interactive={false}
            style={{
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.18)",
              backgroundColor: "rgba(6, 7, 13, 0.96)",
            }}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 }}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onSendReaction?.(emoji);
                    setShowEmojiPicker(false);
                  }}
                  hitSlop={8}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <Text style={{ fontSize: 21 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </DVNTLiquidGlass>
        </Reanimated.View>
      )}

      {quickActions.length > 0 && (
        <View
          pointerEvents="auto"
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
            marginBottom: 12,
            zIndex: 4,
            elevation: 4,
          }}
        >
          {quickActions.map((action) => (
            <ControlButton
              key={action.key}
              compact
              label={action.label}
              onPress={action.onPress}
              active={action.active}
              icon={action.icon}
              displayLabel={action.displayLabel}
              disabled={disabled || isLeaving}
            />
          ))}
        </View>
      )}

      <DVNTLiquidGlass
        interactive={false}
        radius={16}
        paddingH={dock.glassPadding}
        paddingV={8}
        style={{
          alignSelf: "center",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.16)",
          backgroundColor: "rgba(6, 7, 13, 0.88)",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: dock.gap,
          }}
        >
          <ControlButton
            diameter={dock.size}
            displayLabel={hostMuteLocked ? "Host mute" : isMuted ? "Mic off" : "Mic on"}
            // Ending on the server may be slow. Local shutoff is always available.
            disabled={disabled || (isLeaving && isMuted)}
            label={
              hostMuteLocked
                ? "Muted by host — you can't unmute yet"
                : isMuted
                  ? "Unmute microphone"
                  : "Mute microphone"
            }
            active={!isMuted}
            onPress={onToggleMute}
            icon={
              hostMuteLocked ? (
                // gold #F5C518 — the urgency token, not signal: being held
                // muted is a state to understand, not a failure.
                <MicOff size={21} color="#F5C518" />
              ) : isMuted ? (
                <MicOff size={21} color="#F87171" />
              ) : (
                <Mic size={21} color="#F8FAFC" />
              )
            }
          />

          {hasVideo && (
            <ControlButton
              diameter={dock.size}
              displayLabel={isVideoEnabled ? "Cam on" : "Cam off"}
              disabled={disabled || (isLeaving && !isVideoEnabled)}
              label={isVideoEnabled ? "Turn camera off" : "Turn camera on"}
              active={isVideoEnabled}
              onPress={onToggleVideo}
              icon={
                isVideoEnabled ? (
                  <Video size={21} color="#F8FAFC" />
                ) : (
                  <VideoOff size={21} color="#F87171" />
                )
              }
            />
          )}

          <ControlButton
            diameter={dock.size}
            displayLabel="React"
            disabled={disabled || isLeaving || !onSendReaction}
            label={showEmojiPicker ? "Close reactions" : "Open reactions"}
            active={showEmojiPicker}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowEmojiPicker((prev) => !prev);
            }}
            icon={<Heart size={21} color="#FF7BB8" />}
          />

          <ControlButton
            diameter={dock.size}
            displayLabel="Chat"
            disabled={disabled || isLeaving}
            label="Open chat"
            onPress={onOpenChat}
            icon={<MessageCircle size={21} color="#F8FAFC" />}
          />

          <ControlButton
            diameter={dock.size}
            displayLabel={isLeaving ? "Leaving" : "Leave"}
            disabled={isLeaving}
            label={isLeaving ? "Leaving room" : "Leave room"}
            danger
            onPress={() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              );
              onLeave();
            }}
            icon={<LogOut size={21} color="#FCA5A5" />}
          />
        </View>
      </DVNTLiquidGlass>
    </Animated.View>
  );
}
