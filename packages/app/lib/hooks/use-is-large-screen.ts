import { useWindowDimensions } from "react-native";

const LARGE_SCREEN_BREAKPOINT = 768;

export function useIsLargeScreen(): boolean {
  const { width } = useWindowDimensions();
  return width >= LARGE_SCREEN_BREAKPOINT;
}
