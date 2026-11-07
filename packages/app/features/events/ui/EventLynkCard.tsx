import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Radio, ShieldCheck } from "lucide-react-native";
import { EventLynkHostPanel } from "./EventLynkHostPanel";
import { eventLynkCardModel, type EventLynkCardProps } from "./event-lynk-card-model";

export function EventLynkCard(props: EventLynkCardProps) {
  const m = eventLynkCardModel(props);
  return <View className="mx-4 mb-4 overflow-hidden rounded-2xl border border-primary/25 bg-card" testID="event-lynk-card">
    <View className="p-5">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <View className="flex-row items-center gap-2"><Radio size={16} color="#A86BE0" /><Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Event Lynk</Text></View>
        <View className={m.live ? "rounded-full bg-emerald-500/15 px-3 py-1" : "rounded-full bg-secondary px-3 py-1"}><Text accessibilityLiveRegion="polite" className={m.live ? "text-xs font-medium text-emerald-400" : "text-xs font-medium text-muted-foreground"}>{m.badge}</Text></View>
      </View>
      <Text accessibilityRole="header" className="mt-5 text-xl font-semibold text-foreground">{m.title}</Text>
      <Text className="mt-2 text-sm leading-5 text-muted-foreground">{m.description}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={m.action} accessibilityState={{ busy: props.isOpening || m.loading, disabled: m.disabled }} disabled={m.disabled} onPress={props.onOpen} testID="event-lynk-open" style={{ minHeight: 48, opacity: m.disabled ? 0.6 : 1 }} className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 active:opacity-80">
        {props.isOpening || m.loading ? <ActivityIndicator size="small" color="#fff" /> : null}<Text className="text-sm font-semibold text-primary-foreground">{m.action}</Text>
      </Pressable>
      {!m.terminal ? <View className="mt-3 flex-row items-start gap-2"><ShieldCheck size={14} color="#a1a1aa" /><Text className="flex-1 text-xs leading-5 text-muted-foreground">{m.guidance}</Text></View> : null}
      {m.error ? <View className="mt-4 rounded-xl border border-border bg-secondary p-3"><Text accessibilityRole="alert" className="text-sm leading-5 text-foreground">Waiting room unavailable. Your guest list hasn’t been refreshed.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry waiting room" onPress={props.onRetry} style={{ minHeight: 44, justifyContent: "center" }}><Text className="text-sm font-semibold text-primary">Retry waiting room</Text></Pressable></View> : null}
    </View>
    {m.showRoster && props.view ? <EventLynkHostPanel waiting={props.view.waiting} count={props.view.count} isLive={m.live} isStarting={props.isOpening} onStart={props.onOpen} showStart={false} /> : null}
  </View>;
}
