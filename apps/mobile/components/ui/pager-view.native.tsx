import PagerView from "react-native-pager-view";
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
  onPageSelected,
  style,
  pagerRef,
}: PagerViewWrapperProps) {
  return (
    <PagerView
      ref={pagerRef}
      style={style}
      initialPage={initialPage}
      onPageSelected={onPageSelected}
    >
      {children}
    </PagerView>
  );
}
