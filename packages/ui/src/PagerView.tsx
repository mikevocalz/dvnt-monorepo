import PagerViewBase from '@expo/ui/community/pager-view';
import { styled } from 'nativewind';

export type {
  PageScrollStateChangedEvent,
  PageScrollStateChangedEventData,
  PagerViewOnPageScrollEvent,
  PagerViewOnPageScrollEventData,
  PagerViewOnPageSelectedEvent,
  PagerViewOnPageSelectedEventData,
  PagerViewProps,
  PagerViewRef,
} from '@expo/ui/community/pager-view';

export const PagerView = styled(PagerViewBase, {
  className: { target: 'style' },
});
