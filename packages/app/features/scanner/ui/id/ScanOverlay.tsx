import { Dimensions, Animated, StyleSheet } from 'react-native'
import { RNHoleView } from 'react-native-hole-view'
import { useEffect, useRef } from 'react'

const { width, height } = Dimensions.get('window')

export const ID_HOLE = {
  width: width * 0.86,
  height: width * 0.55,
  x: (width - width * 0.86) / 2,
  y: height * 0.22
}

export function ScanOverlay() {
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start()
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.02, duration: 900, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 900, useNativeDriver: true })
      ])
    ).start()
  }, [])

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale }] }]}>
      <RNHoleView
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
        holes={[
          { x: ID_HOLE.x, y: ID_HOLE.y, width: ID_HOLE.width, height: ID_HOLE.height, borderRadius: 14 }
        ]}
      />
    </Animated.View>
  )
}
