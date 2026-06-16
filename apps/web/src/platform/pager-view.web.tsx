'use client';

import React, { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { View } from 'react-native';

type PagerViewProps = {
  children?: React.ReactNode;
  initialPage?: number;
  onPageSelected?: (event: { nativeEvent: { position: number } }) => void;
  style?: unknown;
};

const PagerView = forwardRef(function PagerView(
  { children, initialPage = 0, onPageSelected, style }: PagerViewProps,
  ref,
) {
  const pages = useMemo(() => React.Children.toArray(children), [children]);
  const [page, setPage] = useState(initialPage);

  useImperativeHandle(ref, () => ({
    setPage: (position: number) => {
      setPage(position);
      onPageSelected?.({ nativeEvent: { position } });
    },
    setPageWithoutAnimation: (position: number) => {
      setPage(position);
      onPageSelected?.({ nativeEvent: { position } });
    },
  }));

  return <View style={style as any}>{pages[page] ?? null}</View>;
});

export default PagerView;
export function usePagerView() {
  return {};
}
