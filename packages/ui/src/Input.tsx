import type { ComponentProps } from 'react';
import { Column, TextInput } from '@expo/ui';
import {
  NativeWindExpoColumn,
  NativeWindExpoText,
  NativeWindExpoTextInput,
} from './expo-nativewind';
import { cn } from './utils';

type ExpoTextInputProps = ComponentProps<typeof TextInput>;
type ColumnProps = ComponentProps<typeof Column>;

export interface InputProps extends ExpoTextInputProps {
  label: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  containerStyle?: ColumnProps['style'];
}

export function Input({
  label,
  className,
  inputClassName,
  labelClassName,
  containerStyle,
  style,
  textStyle,
  ...props
}: InputProps) {
  return (
    <NativeWindExpoColumn
      spacing={8}
      className={className}
      style={containerStyle}
    >
      <NativeWindExpoText
        className={cn('text-sm font-semibold text-gray-700', labelClassName)}
      >
        {label}
      </NativeWindExpoText>
      <NativeWindExpoTextInput
        className={cn(
          'rounded-md border border-gray-300 bg-white px-3 py-2.5',
          inputClassName,
        )}
        textClassName="text-base text-gray-900"
        style={style}
        textStyle={textStyle}
        {...props}
      />
    </NativeWindExpoColumn>
  );
}
