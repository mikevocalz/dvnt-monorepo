import React, { useEffect, useRef } from "react"
import { View, Animated, StyleSheet } from "react-native"

interface GradientRefreshControlProps {
  refreshing: boolean
  pullProgress: number
}

const COLORS = ["#34A2DF", "#8A40CF", "#FF5BFC"]

export function GradientRefreshIndicator({ refreshing, pullProgress }: GradientRefreshControlProps) {
  const spinAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0)).current
  const dot1Anim = useRef(new Animated.Value(0)).current
  const dot2Anim = useRef(new Animated.Value(0)).current
  const dot3Anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (refreshing) {
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start()

      Animated.loop(
        Animated.sequence([
          Animated.timing(dot1Anim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(dot2Anim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(dot3Anim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(dot1Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(dot2Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(dot3Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ])
      ).start()
    } else {
      spinAnim.setValue(0)
      dot1Anim.setValue(0)
      dot2Anim.setValue(0)
      dot3Anim.setValue(0)
    }
  }, [refreshing, spinAnim, dot1Anim, dot2Anim, dot3Anim])

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: Math.min(pullProgress, 1),
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start()
  }, [pullProgress, scaleAnim])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  const dot1Scale = dot1Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  })

  const dot2Scale = dot2Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  })

  const dot3Scale = dot3Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  })

  if (pullProgress <= 0 && !refreshing) return null

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.indicatorContainer,
          {
            transform: [
              { scale: scaleAnim },
              { rotate: refreshing ? spin : "0deg" },
            ],
          },
        ]}
      >
        {refreshing ? (
          <View style={styles.dotsContainer}>
            <Animated.View
              style={[
                styles.dot,
                { backgroundColor: COLORS[0], transform: [{ scale: dot1Scale }] },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                { backgroundColor: COLORS[1], transform: [{ scale: dot2Scale }] },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                { backgroundColor: COLORS[2], transform: [{ scale: dot3Scale }] },
              ]}
            />
          </View>
        ) : (
          <View style={styles.circleContainer}>
            <View style={[styles.arcSegment, { backgroundColor: COLORS[0], transform: [{ rotate: "0deg" }] }]} />
            <View style={[styles.arcSegment, { backgroundColor: COLORS[1], transform: [{ rotate: "120deg" }] }]} />
            <View style={[styles.arcSegment, { backgroundColor: COLORS[2], transform: [{ rotate: "240deg" }] }]} />
          </View>
        )}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    height: 60,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  indicatorContainer: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  dotsContainer: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  circleContainer: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  arcSegment: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    top: 0,
    left: 14,
  },
})
