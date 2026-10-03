/**
 * DVNT is dark-only, and that decision lives in one place.
 *
 * This file used to carry its own copy of the hook that re-exported
 * NativeWind's raw setColorScheme. That setter calls
 * Appearance.setColorScheme, which react-native-web does not implement, so
 * the copy kept the DVNT-WEB-S crash reachable from apps/mobile — which has
 * its own Expo web target (`mobile:web`) and already has a .web.tsx importing
 * from here (src/components/map/DvntMap.web.tsx).
 *
 * The shared hook pins dark and guards the capability. apps/mobile/theme/colors
 * and @dvnt/app/theme/colors are byte-identical, so re-exporting changes no
 * palette.
 */
export { useColorScheme } from "@dvnt/app/lib/hooks/use-color-scheme"
