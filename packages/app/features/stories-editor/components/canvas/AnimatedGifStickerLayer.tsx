import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { DVNTGifView } from "@dvnt/app/components/media/DVNTGifView";
import type { StickerElement } from "../../types";
import type { RenderSurface } from "../../utils/geometry";
import { useElementTransform } from "../../hooks/useElementTransform";

interface AnimatedGifStickerLayerProps {
  elements: StickerElement[];
  surface: RenderSurface;
  selectedElementId: string | null;
  showSelection?: boolean;
}

export const AnimatedGifStickerLayer: React.FC<AnimatedGifStickerLayerProps> =
  React.memo(({ elements, surface, selectedElementId, showSelection = true }) => {
    const gifElements = useMemo(
      () =>
        [...elements]
          .filter(
            (element) =>
              element.category === "gif" && typeof element.source === "string",
          )
          .sort((a, b) => a.zIndex - b.zIndex),
      [elements],
    );

    if (gifElements.length === 0) return null;

    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {gifElements.map((element) => (
          <AnimatedGifStickerItem
            key={element.id}
            element={element}
            surface={surface}
            isSelected={showSelection && element.id === selectedElementId}
          />
        ))}
      </View>
    );
  });

AnimatedGifStickerLayer.displayName = "AnimatedGifStickerLayer";

const AnimatedGifStickerItem = React.memo(
  ({
    element,
    surface,
    isSelected,
  }: {
    element: StickerElement;
    surface: RenderSurface;
    isSelected: boolean;
  }) => {
    const { translateX, translateY, scale, rotation } = useElementTransform(
      element.id,
      element.transform,
    );
    const baseSize = element.size * surface.scale;

    const animatedStyle = useAnimatedStyle(
      () => ({
        position: "absolute",
        left: surface.offsetX + translateX.value * surface.scale - baseSize / 2,
        top: surface.offsetY + translateY.value * surface.scale - baseSize / 2,
        width: baseSize,
        height: baseSize,
        transform: [
          { rotate: `${rotation.value}deg` },
          { scale: scale.value },
        ],
      }),
      [baseSize, surface.offsetX, surface.offsetY, surface.scale],
    );

    return (
      <Animated.View
        pointerEvents="none"
        style={[animatedStyle, { zIndex: element.zIndex }]}
      >
        <DVNTGifView
          uri={String(element.source)}
          width="100%"
          height="100%"
          contentFit="contain"
        />
        {isSelected ? <View pointerEvents="none" style={styles.selection} /> : null}
      </Animated.View>
    );
  },
);

AnimatedGifStickerItem.displayName = "AnimatedGifStickerItem";

const styles = StyleSheet.create({
  selection: {
    position: "absolute",
    top: -8,
    right: -8,
    bottom: -8,
    left: -8,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.72)",
  },
});
