import React from "react";
import { Platform, ViewStyle, ImageStyle } from "react-native";
import { Image, ImageProps } from "expo-image";
import Animated from "react-native-reanimated";
import {
  heroImageTransition,
  avatarTransition,
} from "@/lib/shared-transitions";
import type { SharedTransition } from "react-native-reanimated";

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface SharedImageProps extends Omit<ImageProps, "style"> {
  sharedTag?: string;
  style?: ImageStyle | ViewStyle;
  /** Which spring preset to use. Default: 'hero' (big images). Use 'avatar' for small circular elements. */
  transitionPreset?: "hero" | "avatar";
  /** Custom SharedTransition style — overrides preset if provided */
  customTransition?: SharedTransition;
}

// Inline error boundary — if the shared transition crashes, fall back to plain Image
class SharedImageErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn("[SharedImage] Transition error caught:", error.message);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function SharedImage({
  sharedTag,
  style,
  transitionPreset = "hero",
  customTransition,
  ...props
}: SharedImageProps) {
  const imageProps = {
    transition: 200,
    cachePolicy: "memory-disk" as const,
    ...props,
  };

  const plainImage = <Image style={style as ImageStyle} {...imageProps} />;

  if (Platform.OS === "web" || !sharedTag) {
    return plainImage;
  }

  // Select spring preset or use custom
  const transitionStyle =
    customTransition ||
    (transitionPreset === "avatar" ? avatarTransition : heroImageTransition);

  return (
    <SharedImageErrorBoundary fallback={plainImage}>
      <AnimatedImage
        // @ts-ignore - sharedTransitionTag is valid in Reanimated
        sharedTransitionTag={sharedTag}
        // @ts-ignore - SharedTransition builder type
        sharedTransitionStyle={transitionStyle}
        style={
          [
            style as ImageStyle,
            // Android stacking fix: zIndex ensures correct draw order
            Platform.OS === "android" && { zIndex: 9999 },
          ] as any
        }
        {...imageProps}
      />
    </SharedImageErrorBoundary>
  );
}
