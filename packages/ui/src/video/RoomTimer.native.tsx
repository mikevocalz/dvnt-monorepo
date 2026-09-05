import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, AccessibilityInfo } from 'react-native';
import { Clock } from 'lucide-react-native';

export type { RoomTimerProps } from './RoomTimer.types';
import type { RoomTimerProps } from './RoomTimer.types';
import { FREE_ROOM_DURATION_MS, useRoomCountdown } from './RoomTimer.countdown';

export function RoomTimer({
  startedAt,
  durationMs = FREE_ROOM_DURATION_MS,
  onTimeUp,
  className,
}: RoomTimerProps) {
  const { display, visible, remainingMs } = useRoomCountdown(startedAt, durationMs, onTimeUp);
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    // Reduced motion degrades to a static badge — the countdown still reads,
    // it just stops moving. Losing the number would be losing the information.
    if (!visible || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 500,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [visible, reduceMotion, pulse]);

  if (!visible) return null;

  return (
    <Animated.View style={reduceMotion ? undefined : { transform: [{ scale: pulse }] }}>
      <View
        accessibilityLiveRegion={remainingMs <= 10_000 ? 'assertive' : 'polite'}
        accessibilityLabel={`${display} left in this room`}
        className={`flex-row items-center gap-1.5 rounded-[10px] bg-[#FC253A]/90 px-2.5 py-1.5 ${className ?? ''}`}
      >
        <Clock size={14} color="#fff" />
        <Text className="font-mono text-[13px] font-bold text-white">{display}</Text>
      </View>
    </Animated.View>
  );
}
