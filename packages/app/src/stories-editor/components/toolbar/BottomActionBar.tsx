// ============================================================
// Instagram Stories Editor - Bottom Action Bar & Top Nav Bar
// ============================================================
// Design language: matches Create Story screen (36px circular
// buttons, rgba(0,0,0,0.5) backgrounds, Inter font, #3EA4E5 accent)
// ============================================================

import React from "react";
import { View, Pressable, Text } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  Camera,
  Check,
  X,
  Image as ImageIcon,
  Send,
  Download,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { EditorMode } from "../../types";

// ---- Top Navigation Bar ----
// Matches Create Story floating top bar: 36px circles, safe area

interface TopNavBarProps {
  onClose: () => void;
  mode: EditorMode;
  onDone?: () => void;
}

export const TopNavBar: React.FC<TopNavBarProps> = ({
  onClose,
  mode,
  onDone,
}) => {
  const insets = useSafeAreaInsets();

  // Hide in text/drawing mode — those have their own overlays
  if (mode === "text") return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{
        position: "absolute",
        top: insets.top + 8,
        left: 16,
        right: 16,
        zIndex: 100,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      {/* Close button — 36px circle matching Create Story */}
      <Pressable
        onPress={onClose}
        hitSlop={16}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <X size={20} color="#fff" strokeWidth={2.5} />
      </Pressable>

      {/* Right side — mode-dependent actions */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {mode === "drawing" && onDone && (
          <Pressable
            onPress={onDone}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: "#3EA4E5",
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 12,
            }}
          >
            <Check size={16} color="#fff" strokeWidth={2.5} />
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
              Done
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
};

// ---- Bottom Action Bar ----
// Matches Create Story bottom bar: gradient done/share button

interface BottomBarProps {
  mode: EditorMode;
  onDone: () => void;
  onPickMedia: () => void;
  onSaveToLibrary?: () => void;
  hasMedia: boolean;
  hasElements?: boolean;
}

export const BottomActionBar: React.FC<BottomBarProps> = ({
  mode,
  onDone,
  onPickMedia,
  onSaveToLibrary,
  hasMedia,
  hasElements = false,
}) => {
  const insets = useSafeAreaInsets();

  // Hide when a tool panel is active
  if (["text", "drawing", "sticker", "filter", "adjust"].includes(mode)) {
    return null;
  }

  return (
    <Animated.View
      entering={SlideInDown.springify().damping(22).stiffness(200)}
      exiting={SlideOutDown.duration(200)}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: insets.bottom + 8,
        paddingTop: 12,
        paddingHorizontal: 16,
        zIndex: 40,
      }}
    >
      {!hasMedia && !hasElements ? (
        // Empty state — pick media buttons
        <View
          style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPickMedia();
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: "rgba(255,255,255,0.08)",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <ImageIcon size={18} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
              Gallery
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPickMedia();
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: "rgba(255,255,255,0.08)",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <Camera size={18} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
              Camera
            </Text>
          </Pressable>
        </View>
      ) : (
        // Has media — Save + Done buttons (gradient, matching Create Story)
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Save Image to library */}
          {onSaveToLibrary && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onSaveToLibrary();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: "rgba(255,255,255,0.1)",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.15)",
              }}
            >
              <Download size={16} color="#fff" strokeWidth={2.5} />
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
                Save
              </Text>
            </Pressable>
          )}

          {/* Done / Share */}
          <Pressable
            onPress={() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              onDone();
            }}
          >
            <LinearGradient
              colors={["#3EA4E5", "#6C63FF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingHorizontal: 32,
                paddingVertical: 14,
                borderRadius: 16,
                minWidth: 140,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>
                Done
              </Text>
              <Send size={16} color="#fff" strokeWidth={2.5} />
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
};
