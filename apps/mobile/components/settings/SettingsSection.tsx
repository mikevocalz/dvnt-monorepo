import type React from "react"
import { View, Platform } from "react-native"
import { SettingsSectionHeader } from "./SettingsSectionHeader"

interface SettingsSectionProps {
  title: string
  children: React.ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  const isIOS = Platform.OS === "ios"

  return (
    <View className={isIOS ? "mb-6" : "mb-4"}>
      <SettingsSectionHeader title={title} />
      <View className={isIOS ? "rounded-lg bg-card" : ""}>{children}</View>
    </View>
  )
}
