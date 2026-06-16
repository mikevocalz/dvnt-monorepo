import * as React from 'react'
import { View, StyleProp, ViewStyle } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated'
import { cn } from '@/lib/cn'

interface SkeletonProps {
  className?: string
  style?: StyleProp<ViewStyle>
}

function Skeleton({ className, style }: SkeletonProps) {
  const opacity = useSharedValue(0.5)

  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 1000 }),
      -1,
      true
    )
  }, [opacity])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(opacity.value, [0.5, 1], [0.5, 1]),
  }))

  return (
    <Animated.View
      style={[animatedStyle, style]}
      className={cn('rounded-md bg-muted', className)}
    />
  )
}

interface SkeletonCircleProps {
  size: number
  style?: StyleProp<ViewStyle>
}

function SkeletonCircle({ size, style }: SkeletonCircleProps) {
  return (
    <Skeleton
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
    />
  )
}

interface SkeletonTextProps {
  width: number
  height?: number
  style?: StyleProp<ViewStyle>
}

function SkeletonText({ width, height = 12, style }: SkeletonTextProps) {
  return (
    <Skeleton
      style={[{ width, height, borderRadius: 4 }, style]}
    />
  )
}

export { Skeleton, SkeletonCircle, SkeletonText }
