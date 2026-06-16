import { View, Text, Platform } from "react-native"

interface SettingsSectionHeaderProps {
  title: string
}

export function SettingsSectionHeader({ title }: SettingsSectionHeaderProps) {
  const isIOS = Platform.OS === "ios"

  if (isIOS) {
    return (
      <View className="px-4 pb-2 pt-6">
        <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</Text>
      </View>
    )
  }

  return (
    <View className="px-4 pb-2 pt-8">
      <Text className="text-sm font-semibold text-primary">{title}</Text>
    </View>
  )
}
