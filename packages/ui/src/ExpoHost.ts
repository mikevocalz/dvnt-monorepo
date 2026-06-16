import { Host as ExpoHost } from '@expo/ui';
import { styled } from 'nativewind';

export type { UniversalHostProps as ExpoHostProps } from '@expo/ui';

export const Host = styled(ExpoHost, {
  className: { target: 'style' },
});
