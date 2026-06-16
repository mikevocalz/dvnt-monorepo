/**
 * Responsive Media Hook
 * Instagram-like responsive image/video sizing
 * - Full width on phones
 * - Max 614px (Instagram feed width) on tablets, centered
 */

import { useWindowDimensions } from "react-native";

// Instagram feed post max width
const MAX_CONTENT_WIDTH = 614;

// Standard aspect ratios (height = width × ratio)
export const ASPECT_RATIOS = {
  square: 1, // 1:1
  portrait: 5 / 4, // 4:5 — default for feed posts
  landscape: 0.75, // 4:3
  wide: 0.5625, // 16:9
  story: 1.777, // 9:16
} as const;

interface MediaDimensions {
  width: number;
  height: number;
  containerClass: string; // NativeWind classes for centering
}

/**
 * Get responsive media dimensions with Instagram-like centering
 * @param aspectRatio - Aspect ratio key or custom number
 * @param cardMargin - Horizontal margin inside card (default: 4)
 * @param cardBorder - Border width (default: 1)
 */
export function useResponsiveMedia(
  aspectRatio: keyof typeof ASPECT_RATIOS | number = "portrait",
  options?: { cardMargin?: number; cardBorder?: number },
): MediaDimensions {
  const { width: screenWidth } = useWindowDimensions();
  const { cardMargin = 4, cardBorder = 1 } = options || {};

  // Determine if tablet (768px = md breakpoint in NativeWind)
  const isTablet = screenWidth >= 768;

  // Content width: full on phone, max 614px on tablet
  const contentWidth = isTablet
    ? Math.min(screenWidth, MAX_CONTENT_WIDTH)
    : screenWidth;

  // Media width (subtract card decorations)
  const mediaWidth = contentWidth - (cardMargin + cardBorder) * 2;

  // Calculate height from aspect ratio
  const ratio =
    typeof aspectRatio === "number" ? aspectRatio : ASPECT_RATIOS[aspectRatio];
  const mediaHeight = Math.round(mediaWidth * ratio);

  // Container classes: centered on tablet with max-width
  const containerClass = isTablet
    ? "md:max-w-[614px] md:mx-auto w-full"
    : "w-full";

  return {
    width: mediaWidth,
    height: mediaHeight,
    containerClass,
  };
}
