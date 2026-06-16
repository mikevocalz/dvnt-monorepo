import MaskedViewBase from '@react-native-masked-view/masked-view';
import { styled } from 'nativewind';
import type { ViewProps } from 'react-native';

export interface MaskedViewProps extends ViewProps {
  maskElement: React.ReactElement;
  androidRenderingMode?: 'software' | 'hardware';
  className?: string;
}

export const MaskedView = styled(MaskedViewBase, {
  className: { target: 'style' },
});
