import { Pressable, Text, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { cn } from './utils';

interface CheckboxProps extends Omit<PressableProps, 'children'> {
  checked: boolean;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, label, disabled = false, className, ...props }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      className={cn('flex-row items-center gap-2 active:opacity-80', disabled && 'opacity-50', className)}
      {...props}
    >
      <View
        className={cn(
          'h-5 w-5 items-center justify-center rounded border',
          checked ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white',
        )}
      >
        {checked ? <Text className="text-xs font-bold leading-none text-white">✓</Text> : null}
      </View>
      {label ? <Text className="text-sm text-gray-700">{label}</Text> : null}
    </Pressable>
  );
}
