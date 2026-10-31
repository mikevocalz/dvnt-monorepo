import { View, Text, Switch, Pressable } from "react-native";
import { useFollowupScope, useFollowupSettings } from "./use-followup-settings";
import { followupTiming } from "@dvnt/app/lib/events/followup-settings";
export function EventFollowupSettings({ eventId }: { eventId: number }) {
  const scope = useFollowupScope(eventId);
  return <Settings key={scope} eventId={eventId} />;
}
function Settings({ eventId }: { eventId: number }) {
  const s = useFollowupSettings(eventId);
  return <View className="mb-4 rounded-2xl border border-border bg-card p-4 gap-3">
    <Text className="text-base font-semibold text-foreground">Post-party email</Text>
    <Text className="text-sm text-muted-foreground">Optional for this event only. Invite eligible admission ticket holders to rate the event. Unsubscribes are respected.</Text>
    {s.loading ? <Text accessibilityLiveRegion="polite" className="text-foreground">Loading email settings…</Text> : null}
    {s.error ? <View><Text accessibilityRole="alert" className="text-foreground">{s.error}</Text><Pressable accessibilityRole="button" onPress={() => void s.reload()}><Text className="text-primary">Reload email settings</Text></Pressable></View> : null}
    {s.settings ? <>
      <View className="flex-row items-center justify-between gap-3"><Text className="text-foreground">Send a post-party email</Text><Switch accessibilityLabel="Send a post-party email" value={s.enabled} disabled={s.saving} onValueChange={s.toggle} /></View>
      <Text className="text-sm text-muted-foreground">Timing: {followupTiming(s.settings.delay_minutes)}. If this time has already passed, enabling schedules delivery on the next processing run.</Text>
      <Text className="text-sm text-muted-foreground">Saved status: {s.settings.status.replaceAll("_", " ")}. {s.settings.sent_count ?? 0} sent; {s.settings.failed_count ?? 0} failed.</Text>
      <Pressable accessibilityRole="button" disabled={s.saving || s.enabled === s.settings.enabled} onPress={() => void s.save()} className="rounded-xl bg-primary px-4 py-3 disabled:opacity-40"><Text className="font-semibold text-primary-foreground">{s.saving ? "Saving email settings…" : "Save email setting"}</Text></Pressable>
      <Text className="text-xs text-muted-foreground">Saved separately from event details; save any event date changes first. Existing email copy and timing are preserved. Previously emailed attendees are not sent another copy.</Text>
      {s.saved ? <Text accessibilityLiveRegion="polite" className="text-foreground">Email setting saved.</Text> : null}
    </> : null}
  </View>;
}
