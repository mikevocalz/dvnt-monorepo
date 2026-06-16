import type { ComponentProps, ReactNode } from 'react';
import { Button as ExpoButton } from '@expo/ui';
import { NativeWindExpoButton } from './expo-nativewind';
import { cn } from './utils';

type ExpoButtonProps = ComponentProps<typeof ExpoButton>;

export interface ButtonProps
  extends Omit<ExpoButtonProps, 'children' | 'label' | 'variant'> {
  title?: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline';
  className?: string;
  textClassName?: string;
}

const variantMap: Record<NonNullable<ButtonProps['variant']>, ExpoButtonProps['variant']> = {
  primary: 'filled',
  secondary: 'text',
  outline: 'outlined',
};

export function Button({
  title,
  children,
  variant = 'primary',
  className,
  textClassName: _textClassName,
  ...props
}: ButtonProps) {
  return (
    <NativeWindExpoButton
      className={cn('rounded-md px-5 py-2.5 active:opacity-80', className)}
      label={String(children ?? title ?? '')}
      variant={variantMap[variant]}
      {...props}
    />
  );
}
