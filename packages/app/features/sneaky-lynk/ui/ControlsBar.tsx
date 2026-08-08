import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, Text, Pressable, Animated, Easing } from "react-native";
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
  DVNTLiquidGlassIconButton,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import Reanimated, { FadeInRight, FadeOutRight } from "react-native-reanimated";
import type { RoomReaction } from "../hooks/useRoomReactions";

const REACTION_EMOJIS = ["😂", "😢", "😊", "😈", "🥵", "💝"];

interface ControlsBarProps {
  isMuted: boolean;
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
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.72)).current;
  const drift = useRef(
    new Animated.Value(
      reaction.isOwn ? -18 - Math.random() * 22 : 18 + Math.random() * 22,
    ),
  ).current;

  useRef(
    Animated.parallel([
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
    ]).start(onComplete),
  ).current;

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
  onPress,
  active = false,
  danger = false,
  compact = false,
  showLabel = true,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 22,
      bounciness: 5,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 22,
      bounciness: 5,
    }).start();
  }, [scale]);

  const size = compact ? 42 : 52;
  const labelColor = danger
    ? "#FCA5A5"
    : active
      ? "#E2F2FF"
      : "rgba(255,255,255,0.72)";

  return (
    <View
      style={{
        alignItems: "center",
        gap: showLabel ? 5 : 0,
        minWidth: compact ? 42 : 52,
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          collapsable={false}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
          }}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          hitSlop={compact ? 12 : 10}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={{ zIndex: 2, elevation: 2 }}
          onStartShouldSetResponder={() => true}
        >
          {compact ? (
            <View
              style={{
                width: size,
                height: size,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: danger
                  ? "rgba(248, 113, 113, 0.34)"
                  : active
                    ? "rgba(104, 198, 255, 0.38)"
                    : "rgba(255,255,255,0.16)",
                backgroundColor: danger
                  ? "rgba(127, 29, 29, 0.28)"
                  : active
                    ? "rgba(46, 157, 255, 0.26)"
                    : "rgba(12,16,24,0.88)",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.24,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 8 },
              }}
            >
              {icon}
            </View>
          ) : (
            <DVNTLiquidGlassIconButton
              size={size}
              interactive={false}
              style={{
                borderWidth: 1,
                borderColor: danger
                  ? "rgba(248, 113, 113, 0.34)"
                  : active
                    ? "rgba(104, 198, 255, 0.38)"
                    : "rgba(255,255,255,0.16)",
              }}
            >
              <View
                style={{
                  width: "100%",
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: danger
                    ? "rgba(127, 29, 29, 0.28)"
                    : active
                      ? "rgba(46, 157, 255, 0.26)"
                      : "rgba(255,255,255,0.04)",
                }}
              >
                {icon}
              </View>
            </DVNTLiquidGlassIconButton>
          )}
        </Pressable>
      </Animated.View>
      {showLabel ? (
        <Text
          style={{
            color: labelColor,
            fontSize: compact ? 10 : 11,
            fontWeight: "700",
          }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ControlsBar({
  isMuted,
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
  const insets = useSafeAreaInsets();
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
      duration: overlayOpen ? 140 : 180,
      easing: overlayOpen ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [dockVisibility, overlayOpen]);

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
              label: "Flip",
              onPress: onSwitchCamera,
              icon: <RotateCcw size={18} color="#E2F2FF" />,
            }
          : null,
        canRaiseHand
          ? {
              key: "hand",
              label: "Hand",
              onPress: onToggleHand,
              icon: (
                <Hand size={18} color={handRaised ? "#FBBF24" : "#F8FAFC"} />
              ),
              active: handRaised,
            }
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
    ],
  );

  return (
    <Animated.View
      pointerEvents={overlayOpen ? "none" : "box-none"}
      accessibilityElementsHidden={overlayOpen}
      importantForAccessibility={overlayOpen ? "no-hide-descendants" : "yes"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom + 10,
        paddingHorizontal: 14,
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
            alignSelf: "flex-end",
            marginBottom: 12,
            marginRight: 2,
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
              backgroundColor: "rgba(3, 7, 18, 0.18)",
            }}
          >
            <View style={{ flexDirection: "column", gap: 8 }}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onSendReaction?.(emoji);
                    setShowEmojiPicker(false);
                  }}
                  hitSlop={8}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
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
            marginBottom: 10,
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
              showLabel={false}
            />
          ))}
        </View>
      )}

      <DVNTLiquidGlass
        interactive={false}
        radius={22}
        paddingH={10}
        paddingV={10}
        style={{
          alignSelf: "center",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.16)",
          backgroundColor: "rgba(5, 10, 22, 0.22)",
          shadowColor: "#000",
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <ControlButton
            label={isMuted ? "Unmute microphone" : "Mute microphone"}
            active={!isMuted}
            onPress={onToggleMute}
            icon={
              isMuted ? (
                <MicOff size={21} color="#F87171" />
              ) : (
                <Mic size={21} color="#F8FAFC" />
              )
            }
            showLabel={false}
          />

          {hasVideo && (
            <ControlButton
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
              showLabel={false}
            />
          )}

          <ControlButton
            label="Open reactions"
            active={showEmojiPicker}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowEmojiPicker((prev) => !prev);
            }}
            icon={<Heart size={21} color="#FF7BB8" />}
            showLabel={false}
          />

          <ControlButton
            label="Open chat"
            onPress={onOpenChat}
            icon={<MessageCircle size={21} color="#F8FAFC" />}
            showLabel={false}
          />

          {onReport && (
            <ControlButton
              label="Report"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onReport();
              }}
              icon={<Flag size={21} color="rgba(255,255,255,0.72)" />}
              showLabel={false}
            />
          )}

          <ControlButton
            label="Leave room"
            danger
            onPress={() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              );
              onLeave();
            }}
            icon={<LogOut size={21} color="#FCA5A5" />}
            showLabel={false}
          />
        </View>
      </DVNTLiquidGlass>
    </Animated.View>
  );
}
