import SliderBase from '@expo/ui/community/slider';
import { styled } from 'nativewind';

export type { SliderProps } from '@expo/ui/community/slider';

export const Slider = styled(SliderBase, {
  className: { target: 'style' },
});
