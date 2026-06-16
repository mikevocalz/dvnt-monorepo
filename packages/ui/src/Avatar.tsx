import { Image, Text, View } from 'react-native';
import type { ImageSourcePropType, ViewProps } from 'react-native';
import { cn } from './utils';

interface AvatarProps extends ViewProps {
  source?: ImageSourcePropType;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

const textSizes = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
};

function initialsFor(name?: string) {
  return (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function Avatar({ source, name, size = 'md', className, ...props }: AvatarProps) {
  return (
    <View
      className={cn('items-center justify-center overflow-hidden rounded-full bg-gray-100', sizes[size], className)}
      accessibilityLabel={name ? `${name} avatar` : 'Avatar'}
      {...props}
    >
      {source ? (
        <Image source={source} className="h-full w-full" resizeMode="cover" />
      ) : (
        <Text className={cn('font-medium text-gray-700', textSizes[size])}>{initialsFor(name)}</Text>
      )}
    </View>
  );
}
