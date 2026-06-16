import type { ComponentProps } from 'react';
import { Row, Text } from '@expo/ui';
import { NativeWindExpoRow, NativeWindExpoText } from './expo-nativewind';
import { cn } from './utils';

type RowProps = ComponentProps<typeof Row>;

export interface BadgeProps extends RowProps {
  label: string;
  variant?: 'default' | 'success' | 'warning';
  className?: string;
  textClassName?: string;
}

export function Badge({
  label,
  variant = 'default',
  className,
  textClassName,
  style,
  ...props
}: BadgeProps) {
  return (
    <NativeWindExpoRow
      className={cn(
        'self-start rounded-full px-2.5 py-1',
        variant === 'default' && 'bg-gray-100',
        variant === 'success' && 'bg-green-100',
        variant === 'warning' && 'bg-amber-100',
        className,
      )}
      style={style}
      {...props}
    >
      <NativeWindExpoText
        className={cn(
          'text-xs font-semibold',
          variant === 'default' && 'text-gray-700',
          variant === 'success' && 'text-green-700',
          variant === 'warning' && 'text-amber-700',
          textClassName,
        )}
      >
        {label}
      </NativeWindExpoText>
    </NativeWindExpoRow>
  );
}
