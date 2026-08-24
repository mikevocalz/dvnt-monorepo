import { View, Text } from 'react-native';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react-native';

export type { ConnectionPhase, ConnectionBannerProps } from './ConnectionBanner.types';
import type { ConnectionBannerProps, ConnectionPhase } from './ConnectionBanner.types';

const GOLD = '#F5C518';
const SIGNAL = '#FC253A';
const DIM = 'rgba(255,255,255,0.60)';

const PHASE = {
  connecting: { label: 'Connecting', color: DIM, Icon: Wifi },
  degraded: { label: 'Weak connection', color: GOLD, Icon: AlertTriangle },
  reconnecting: { label: 'Reconnecting', color: GOLD, Icon: WifiOff },
  disconnected: { label: 'Disconnected', color: SIGNAL, Icon: WifiOff },
} as const satisfies Record<Exclude<ConnectionPhase, 'connected'>, unknown>;

export function ConnectionBanner({
  phase,
  attempt,
  detail,
  action,
  className,
}: ConnectionBannerProps) {
  if (phase === 'connected') return null;
  const { label, color, Icon } = PHASE[phase];

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={phase === 'disconnected' ? 'alert' : 'text'}
      accessibilityLabel={
        attempt ? `${label}, attempt ${attempt.current} of ${attempt.max}` : label
      }
      className={`mx-4 my-2 flex-row items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 ${className ?? ''}`}
    >
      <Icon size={16} color={color} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text style={{ color }} className="text-sm font-medium">
            {label}
          </Text>
          {attempt ? (
            // Space Mono: a bounded retry is transactional data, the same
            // voice as the room timer and "3/5 checked in".
            <Text style={{ color }} className="font-mono text-xs opacity-80">
              {attempt.current}/{attempt.max}
            </Text>
          ) : null}
        </View>
        {detail ? (
          <Text className="mt-0.5 text-xs text-white/40" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
