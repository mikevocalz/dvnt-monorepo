import type { ComponentProps, ReactNode } from 'react';
import { Text as ExpoText } from '@expo/ui';
import { NativeWindExpoText } from './expo-nativewind';
import { cn } from './utils';

type ExpoTextProps = ComponentProps<typeof ExpoText>;

export interface TextProps extends Omit<ExpoTextProps, 'children'> {
  children?: ReactNode;
  variant?: 'title' | 'body' | 'caption';
  className?: string;
}

const variantTextStyle: Record<
  NonNullable<TextProps['variant']>,
  NonNullable<ExpoTextProps['textStyle']>
> = {
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  body: { fontSize: 16, color: '#111827' },
  caption: { fontSize: 14, color: '#6b7280' },
};

export function Text({
  children,
  variant = 'body',
  className,
  textStyle,
  ...props
}: TextProps) {
  return (
    <NativeWindExpoText
      className={cn(
        variant === 'title' && 'text-xl font-bold text-gray-900',
        variant === 'body' && 'text-base text-gray-900',
        variant === 'caption' && 'text-sm text-gray-500',
        className,
      )}
      textStyle={textStyle ?? variantTextStyle[variant]}
      {...props}
    >
      {String(children ?? '')}
    </NativeWindExpoText>
  );
}
