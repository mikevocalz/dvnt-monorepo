import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { Skeleton } from './Skeleton';
import { cn } from './utils';

interface ScreenSkeletonProps extends ViewProps {
  rows?: number;
  className?: string;
}

export function ScreenSkeleton({ rows = 4, className, ...props }: ScreenSkeletonProps) {
  return (
    <View className={cn('gap-4 p-6', className)} {...props}>
      <Skeleton className="h-8 w-2/3" />
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} className="gap-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </View>
      ))}
    </View>
  );
}
