import { View, Dimensions, PanResponder } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { useRef, useState, useEffect, useCallback } from "react"
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  interpolate,
  Extrapolation
} from "react-native-reanimated"

const { width: SCREEN_WIDTH } = Dimensions.get("window")

interface VideoSeekBarProps {
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  onSeekEnd?: () => void
  visible: boolean
  barWidth?: number
}

export function VideoSeekBar({ 
  currentTime, 
  duration, 
  onSeek,
  onSeekEnd,
  visible,
  barWidth = SCREEN_WIDTH - 32
}: VideoSeekBarProps) {
  const opacity = useSharedValue(0)
  const [isDragging, setIsDragging] = useState(false)
  const [localProgress, setLocalProgress] = useState(0)
  const barRef = useRef<View>(null)
  const barX = useRef(0)

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 })
  }, [visible, opacity])

  useEffect(() => {
    if (!isDragging && duration > 0) {
      setLocalProgress(currentTime / duration)
    }
  }, [currentTime, duration, isDragging])

  const handleSeek = useCallback((locationX: number) => {
    const progress = Math.max(0, Math.min(1, locationX / barWidth))
    setLocalProgress(progress)
    const seekTime = progress * duration
    onSeek(seekTime)
  }, [barWidth, duration, onSeek])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsDragging(true)
        const locationX = evt.nativeEvent.locationX
        handleSeek(locationX)
      },
      onPanResponderMove: (evt, gestureState) => {
        const locationX = gestureState.moveX - barX.current
        handleSeek(locationX)
      },
      onPanResponderRelease: () => {
        setIsDragging(false)
        onSeekEnd?.()
      },
      onPanResponderTerminate: () => {
        setIsDragging(false)
        onSeekEnd?.()
      },
    })
  ).current

  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: interpolate(opacity.value, [0, 1], [10, 0], Extrapolation.CLAMP) }],
  }))

  const progress = isDragging ? localProgress : (duration > 0 ? currentTime / duration : 0)

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          bottom: 4,
          left: 16,
          right: 16,
          height: 24,
          justifyContent: "center",
          zIndex: 100,
        },
        animatedContainerStyle,
      ]}
    >
      <View
        ref={barRef}
        onLayout={(e) => {
          barRef.current?.measureInWindow((x) => {
            barX.current = x
          })
        }}
        style={{
          width: barWidth,
          height: 4,
          backgroundColor: "rgba(255,255,255,0.3)",
          borderRadius: 2,
          overflow: "hidden",
        }}
        {...panResponder.panHandlers}
      >
        <LinearGradient
          colors={["#34A2DF", "#8A40CF", "#FF5BFC"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            borderRadius: 2,
          }}
        />
      </View>
      {/* Thumb indicator */}
      <View
        style={{
          position: "absolute",
          left: progress * barWidth - 6,
          top: 6,
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: "#FF5BFC",
          shadowColor: "#FF5BFC",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 4,
          elevation: 4,
        }}
        pointerEvents="none"
      />
    </Animated.View>
  )
}
