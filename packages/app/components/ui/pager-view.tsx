import { View } from "react-native";
import type { ReactNode } from "react";

interface PagerViewWrapperProps {
  children: ReactNode[];
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  style?: any;
  pagerRef?: any;
}

export function PagerViewWrapper({
  children,
  initialPage = 0,
  style,
}: PagerViewWrapperProps) {
  return <View style={style}>{children[initialPage]}</View>;
}
