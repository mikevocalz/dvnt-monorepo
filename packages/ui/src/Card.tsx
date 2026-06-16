import type { ComponentProps } from 'react';
import { Column } from '@expo/ui';
import { NativeWindExpoColumn } from './expo-nativewind';
import { cn } from './utils';

type ColumnProps = ComponentProps<typeof Column>;

export interface CardProps extends ColumnProps {
  variant?: 'default' | 'elevated';
  className?: string;
}

export function Card({
  children,
  variant = 'default',
  className,
  style,
  ...props
}: CardProps) {
  return (
    <NativeWindExpoColumn
      spacing={12}
      className={cn(
        'rounded-lg border bg-white p-5',
        variant === 'elevated' ? 'border-gray-100 shadow-md' : 'border-gray-200',
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </NativeWindExpoColumn>
  );
}
