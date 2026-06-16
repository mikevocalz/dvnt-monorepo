import {
  Children,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from 'react';
import type {
  PageScrollStateChangedEvent,
  PagerViewOnPageScrollEvent,
  PagerViewOnPageSelectedEvent,
  PagerViewProps as ExpoPagerViewProps,
  PagerViewRef,
} from '@expo/ui/community/pager-view';

export type PagerViewProps = ExpoPagerViewProps & {
  className?: string;
};

export type {
  PageScrollStateChangedEvent,
  PageScrollStateChangedEventData,
  PagerViewOnPageScrollEvent,
  PagerViewOnPageScrollEventData,
  PagerViewOnPageSelectedEvent,
  PagerViewOnPageSelectedEventData,
  PagerViewRef,
} from '@expo/ui/community/pager-view';

function pageSelectedEvent(position: number): PagerViewOnPageSelectedEvent {
  return { nativeEvent: { position } } as PagerViewOnPageSelectedEvent;
}

function pageScrollEvent(position: number, offset: number): PagerViewOnPageScrollEvent {
  return { nativeEvent: { position, offset } } as PagerViewOnPageScrollEvent;
}

function pageScrollStateEvent(
  pageScrollState: 'dragging' | 'idle' | 'settling',
): PageScrollStateChangedEvent {
  return { nativeEvent: { pageScrollState } } as PageScrollStateChangedEvent;
}

export function PagerView({
  children,
  className,
  initialPage = 0,
  onPageScroll,
  onPageScrollStateChanged,
  onPageSelected,
  ref,
  scrollEnabled = true,
  style,
  testID,
}: PagerViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPageRef = useRef(initialPage);
  const [isReady, setIsReady] = useState(false);
  const pages = useMemo(() => Children.toArray(children), [children]);

  function scrollToPage(selectedPage: number, behavior: ScrollBehavior) {
    const node = scrollRef.current;
    if (!node || selectedPage < 0 || selectedPage >= pages.length) {
      return;
    }

    node.scrollTo({
      behavior,
      left: selectedPage * node.clientWidth,
    });
  }

  useImperativeHandle(ref, () => ({
    setPage: (selectedPage: number) => scrollToPage(selectedPage, 'smooth'),
    setPageWithoutAnimation: (selectedPage: number) => scrollToPage(selectedPage, 'auto'),
    setScrollEnabled: () => {
      // The web fallback is prop-driven. Keep the method for API compatibility.
    },
  }));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToPage(initialPage, 'auto');
      setIsReady(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialPage]);

  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) {
        window.clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    const width = node.clientWidth || 1;
    const rawPage = node.scrollLeft / width;
    const position = Math.floor(rawPage);
    const offset = rawPage - position;
    const selectedPage = Math.round(rawPage);

    onPageScroll?.(pageScrollEvent(position, offset));
    onPageScrollStateChanged?.(pageScrollStateEvent('dragging'));

    if (idleTimeoutRef.current) {
      window.clearTimeout(idleTimeoutRef.current);
    }

    idleTimeoutRef.current = window.setTimeout(() => {
      onPageScrollStateChanged?.(pageScrollStateEvent('idle'));
    }, 120);

    if (selectedPage !== selectedPageRef.current) {
      selectedPageRef.current = selectedPage;
      onPageSelected?.(pageSelectedEvent(selectedPage));
    }
  }

  return (
    <div
      className={className}
      data-testid={testID}
      ref={scrollRef}
      style={{
        display: 'flex',
        overflowX: scrollEnabled ? 'auto' : 'hidden',
        opacity: isReady ? 1 : 0,
        scrollBehavior: 'smooth',
        scrollSnapType: 'x mandatory',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        ...(style as CSSProperties),
      }}
      onScroll={handleScroll}
    >
      {pages.map((page, index) => (
        <div
          key={String(index)}
          style={{
            flex: '0 0 100%',
            minWidth: '100%',
            scrollSnapAlign: 'start',
          }}
        >
          {page}
        </div>
      ))}
    </div>
  );
}
