import { View, Text } from "react-native";
import { type LucideIcon } from "lucide-react-native";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Optional accent color for the icon glow (defaults to primary-ish blue) */
  accent?: string;
  /** Compact variant for inline usage (less padding) */
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  accent = "#3b82f6",
  compact = false,
}: EmptyStateProps) {
  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={{ paddingVertical: compact ? 32 : 64 }}
    >
      {/* Icon with subtle glow ring */}
      <View className="items-center justify-center mb-6">
        <View
          className="absolute w-28 h-28 rounded-full"
          style={{ backgroundColor: `${accent}08` }}
        />
        <View
          className="w-20 h-20 rounded-full items-center justify-center"
          style={{ backgroundColor: `${accent}12` }}
        >
          <Icon size={36} color={accent} strokeWidth={1.5} />
        </View>
      </View>
      <Text className="text-xl font-semibold text-foreground text-center mb-2">
        {title}
      </Text>
      {description && (
        <Text className="text-muted-foreground text-center text-base leading-6 max-w-[280px]">
          {description}
        </Text>
      )}
      {action && <View className="mt-6">{action}</View>}
    </View>
  );
}
