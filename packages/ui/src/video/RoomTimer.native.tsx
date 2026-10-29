import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, AccessibilityInfo, AppState } from 'react-native';
import { Clock } from 'lucide-react-native';

export type { RoomTimerProps } from './RoomTimer.types';
import type { RoomTimerProps } from './RoomTimer.types';
import { FREE_ROOM_DURATION_MS, useRoomCountdown } from './RoomTimer.countdown';

export function RoomTimer({
  startedAt,
  endsAt,
  durationMs = FREE_ROOM_DURATION_MS,
  onTimeUp,
  className,
  compact = false,
}: RoomTimerProps) {
  const { display, visible, warning, expired, refresh } = useRoomCountdown(startedAt, durationMs, onTimeUp, endsAt);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
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
    if (!visible || !warning || reduceMotion || compact) {
      pulse.setValue(1);
      return;
    }
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
  }, [visible, warning, reduceMotion, compact, pulse]);

  if (!visible) return null;

  return (
    <Animated.View style={[{ alignSelf: 'stretch', minWidth: 0, marginTop: 4 }, reduceMotion || !warning || compact ? undefined : { transform: [{ scale: pulse }] }]}>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 }}
        accessibilityLabel={expired ? "Session ended" : `Time left ${display}`}
        className={`flex-row flex-wrap items-center rounded-[10px] ${warning ? 'bg-[#FC253A]/90' : 'bg-white/10'} ${compact ? 'gap-1 px-1.5 py-1' : 'gap-1.5 px-2.5 py-1.5'} ${className ?? ''}`}
      >
        {compact ? null : <Clock size={14} color="#fff" />}
        <Text style={{ fontSize: compact ? 12 : 13, lineHeight: 18, flexShrink: 1 }} className={`font-mono font-bold text-white ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
          {expired ? "Session ended" : `Time left ${display}`}
        </Text>
      </View>
      {warning || expired ? (
        <Text style={{ fontSize: 12, lineHeight: 18, flexShrink: 1 }} accessibilityLiveRegion="polite" accessibilityLabel={expired ? "This room has ended" : "Room ending in 30 seconds or less"} className="text-[12px] text-white">
          {expired ? "This room has ended" : "30 seconds or less"}
        </Text>
      ) : null}
    </Animated.View>
  );
}
