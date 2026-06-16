import { Pressable, Text, View } from 'react-native';
import type { ViewProps } from 'react-native';
import { cn } from './utils';

export interface TabItem<TValue extends string = string> {
  label: string;
  value: TValue;
}

interface TabsProps<TValue extends string = string> extends ViewProps {
  items: TabItem<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  className?: string;
}

export function Tabs<TValue extends string = string>({
  items,
  value,
  onValueChange,
  className,
  ...props
}: TabsProps<TValue>) {
  return (
    <View className={cn('flex-row rounded-md bg-gray-100 p-1', className)} accessibilityRole="tablist" {...props}>
      {items.map((item) => {
        const selected = item.value === value;

        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onValueChange(item.value)}
            className={cn('flex-1 rounded px-3 py-2', selected && 'bg-white shadow-sm')}
          >
            <Text className={cn('text-center text-sm font-medium', selected ? 'text-gray-900' : 'text-gray-500')}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
