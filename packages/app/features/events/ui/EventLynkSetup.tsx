import React from "react";
import { View, Text, Switch } from "react-native";
import { EVENT_LYNK_SETUP as copy, type EventLynkSetupProps } from "./event-lynk-setup";

export function EventLynkSetup({ enabled, onChange, linked = false }: EventLynkSetupProps) {
  if (!onChange && !enabled) return null;
  return <View className={enabled ? "rounded-2xl border border-primary/40 bg-primary/10 p-4" : "rounded-2xl border border-border bg-card p-4"} testID="event-lynk-setup">
    {onChange ? <View className="flex-row items-start gap-3">
      <View className="flex-1"><Text className="text-sm font-semibold text-foreground">{copy.label}</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">{copy.description}</Text></View>
      <View style={{ minHeight: 44, justifyContent: "center" }}><Switch accessibilityLabel={copy.label} accessibilityHint={copy.description} value={enabled} onValueChange={onChange} trackColor={{ false: "#374151", true: "#8A40CF" }} thumbColor="#fff" /></View>
    </View> : <Text className="text-sm font-semibold text-foreground">{linked ? copy.linkedTitle : copy.draftTitle}</Text>}
    {enabled ? <View className={onChange ? "mt-4 border-t border-border pt-4" : "mt-3"}>
      <Text className="text-xs font-semibold text-primary">{linked ? copy.linkedStatus : copy.draftStatus}</Text>
      <View className="mt-3 gap-3">{copy.steps.map((step, i) => <View key={step} className="flex-row items-start gap-2"><View accessible={false} className="h-5 w-5 items-center justify-center rounded-full bg-secondary"><Text className="text-xs text-muted-foreground">{i + 1}</Text></View><Text className="flex-1 text-xs leading-5 text-muted-foreground">{step}</Text></View>)}</View>
    </View> : null}
  </View>;
}
