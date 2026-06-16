import { View } from 'react-native';
import type { DimensionValue, ViewProps } from 'react-native';
import { cn } from './utils';

interface ProgressProps extends ViewProps {
  value: number;
  className?: string;
  indicatorClassName?: string;
}

export function Progress({ value, className, indicatorClassName, ...props }: ProgressProps) {
  const width = `${Math.max(0, Math.min(100, value))}%` as DimensionValue;

  return (
    <View className={cn('h-2 overflow-hidden rounded-full bg-gray-100', className)} {...props}>
      <View className={cn('h-full rounded-full bg-gray-900', indicatorClassName)} style={{ width }} />
    </View>
  );
}
