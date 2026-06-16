import { View } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';
import { Button } from './Button';
import { Text } from './Text';
import { cn } from './utils';

interface EmptyStateProps extends ViewProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onActionPress,
  icon,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <View className={cn('items-center justify-center gap-3 p-8', className)} {...props}>
      {icon}
      <Text variant="title" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text variant="caption" className="max-w-sm text-center">
          {description}
        </Text>
      ) : null}
      {actionLabel && onActionPress ? <Button title={actionLabel} onPress={onActionPress} /> : null}
    </View>
  );
}
