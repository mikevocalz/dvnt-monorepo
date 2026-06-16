import { Pressable, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { cn } from './utils';

interface SwitchProps extends Omit<PressableProps, 'children'> {
  checked: boolean;
  disabled?: boolean;
  className?: string;
  /** Fired with the next checked value when the switch is pressed. */
  onCheckedChange?: (checked: boolean) => void;
}

export function Switch({
  checked,
  disabled = false,
  className,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onCheckedChange ? () => onCheckedChange(!checked) : undefined}
      className={cn(
        'h-7 w-12 justify-center rounded-full px-0.5 active:opacity-80',
        checked ? 'items-end bg-gray-900' : 'items-start bg-gray-200',
        disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <View className="h-6 w-6 rounded-full bg-white shadow-sm" />
    </Pressable>
  );
}
