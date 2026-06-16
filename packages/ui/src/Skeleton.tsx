import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { cn } from './utils';

interface SkeletonProps extends ViewProps {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <View className={cn('rounded-md bg-gray-100', className)} accessibilityRole="progressbar" {...props} />;
}
