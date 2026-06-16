import type React from "react"
import { View, Text, Pressable, Platform } from "react-native"
import { ChevronRight } from "lucide-react-native"

interface SettingsListItemProps {
  icon?: React.ReactNode
  label: string
  value?: string
  onPress?: () => void
  destructive?: boolean
  variant?: "default" | "switch"
  switchValue?: boolean
}

export function SettingsListItem({
  icon,
  label,
  value,
  onPress,
  destructive,
  variant = "default",
  switchValue,
}: SettingsListItemProps) {
  const isIOS = Platform.OS === "ios"

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between px-4 py-3 ${
        isIOS ? "active:bg-secondary/50" : "active:bg-secondary/30"
      }`}
    >
      <View className="flex-1 flex-row items-center gap-3">
        {icon && <View className="w-6 items-center">{icon}</View>}
        <Text className={`flex-1 text-base ${destructive ? "text-destructive" : "text-foreground"}`}>{label}</Text>
      </View>
      {value && <Text className="mr-2 text-base text-muted-foreground">{value}</Text>}
      {variant === "default" && <ChevronRight size={20} color="#999" />}
    </Pressable>
  )
}
