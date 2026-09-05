// ============================================================
// Instagram Stories Editor - Background Color/Gradient Picker
// ============================================================
// Shown when no media is loaded (text-only stories).
// Instagram-style horizontal scroll of color circles.

import React from "react";
import { View, Pressable, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { STORY_BACKGROUNDS, StoryBackground } from "../../constants";

const SWATCH = 32;

interface BackgroundPickerProps {
  selectedId: string;
  onSelect: (bg: StoryBackground) => void;
}

export const BackgroundPicker: React.FC<BackgroundPickerProps> = ({
  selectedId,
  onSelect,
}) => {
  return (
    <View className="absolute bottom-[100px] left-0 right-0">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 10,
          alignItems: "center",
        }}
      >
        {STORY_BACKGROUNDS.map((bg) => {
          const isSelected = bg.id === selectedId;
          return (
            <Pressable
              key={bg.id}
              className={`items-center justify-center border-2 ${
                isSelected ? "border-white" : "border-transparent"
              }`}
              style={{
                width: SWATCH + 6,
                height: SWATCH + 6,
                borderRadius: (SWATCH + 6) / 2,
              }}
              onPress={() => onSelect(bg)}
            >
              {bg.type === "gradient" && bg.colors ? (
                <LinearGradient
                  colors={bg.colors as [string, string, ...string[]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    width: SWATCH,
                    height: SWATCH,
                    borderRadius: SWATCH / 2,
                    overflow: "hidden",
                  }}
                />
              ) : (
                <View
                  style={{
                    width: SWATCH,
                    height: SWATCH,
                    borderRadius: SWATCH / 2,
                    backgroundColor: bg.color,
                    overflow: "hidden",
                  }}
                >
                  {bg.color === "#000000" && (
                    <View
                      className="absolute border border-neutral-600"
                      style={{
                        top: SWATCH / 2 - 4,
                        left: SWATCH / 2 - 4,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                      }}
                    />
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};
