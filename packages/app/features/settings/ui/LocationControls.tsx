import { MAP_SHARING_DISCLOSURE } from "@dvnt/app/features/events/ui/map-sharing-prompt";
import { useEffect, useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import { useLocationSettings, useMapSharingConsent } from "@dvnt/app/lib/hooks/use-member-map";

import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function LocationControls({ allowSharing = true }: { allowSharing?: boolean }) {
  const location = useLocationSettings();
  const consent = useMapSharingConsent(allowSharing);
  const owner = useAuthStore(state => state.user?.authId);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setConfirm(false); }, [owner]);
  const share = async () => { if (allowSharing && await consent.share() && useAuthStore.getState().user?.authId === owner) setConfirm(false); };
  const dismiss = () => { consent.cancel(); setConfirm(false); };
  const disabled = location.loading || location.busy || consent.busy || !location.settings;
  return <View accessibilityLabel="Location settings" className="mt-4 rounded-xl border border-border bg-card p-4">
    <Text className="font-semibold text-foreground">Location</Text>
    <View className="flex-row items-center gap-3 py-4"><View className="flex-1"><Text className="font-semibold text-foreground">Use device location</Text><Text className="text-sm text-muted-foreground">Overall DVNT location control. Off stops location updates and removes your Events map avatar. You can still choose a city manually.</Text></View><Switch accessibilityLabel="Use device location" disabled={disabled} value={location.enabled} onValueChange={(value) => void location.setOverall(value)} /></View>
    <View className="flex-row items-center gap-3 border-t border-border py-4"><View className="flex-1"><Text className="font-semibold text-foreground">Show my avatar on Events map</Text><Text className="text-sm text-muted-foreground">Share your approximate area across your account until you turn it off. This never indicates attendance at an event.</Text></View><Switch accessibilityLabel="Show my avatar on Events map" disabled={disabled || (!location.sharing && (!location.enabled || !allowSharing))} value={location.sharing} onValueChange={(value) => { if (!value) void location.setSharing(false); else setConfirm(true); }} /></View>
    {confirm && location.enabled && allowSharing ? <View className="gap-3 rounded-xl border border-primary p-3"><Text className="text-sm text-foreground">{MAP_SHARING_DISCLOSURE}</Text><Pressable accessibilityRole="button" disabled={disabled} className="min-h-11 justify-center rounded-xl bg-primary p-3" onPress={() => void share()}><Text className="font-semibold text-primary-foreground">Share across my devices</Text></Pressable><Pressable accessibilityRole="button" className="min-h-11 justify-center p-3" onPress={dismiss}><Text className="text-foreground">Cancel</Text></Pressable></View> : null}
    {location.sharing && location.settings?.consentVersion === "events-map-account-v3" ? <Text className="mt-2 text-sm text-muted-foreground">Avatar sharing is enabled across your account until you turn it off. Each device still needs location permission. Open the Events map and tap Update my location if your avatar is missing.</Text> : null}
    {location.sharing && location.settings?.shareUntil ? <Text className="mt-2 text-sm text-muted-foreground">Avatar sharing is enabled until {new Date(location.settings.shareUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. This preference does not confirm a current device location. Open the Events map and tap Update my location if your avatar is missing. Fresh locations update while the map is open.</Text> : null}
    {consent.error ? <Text accessibilityRole="alert" className="mt-3 text-destructive">{consent.error}</Text> : null}
    {consent.busy ? <Text accessibilityLiveRegion="polite" className="text-muted-foreground">Waiting for location permission and a fresh location…</Text> : null}
    {location.loading ? <Text accessibilityRole="text" className="text-muted-foreground">Loading location settings…</Text> : null}
    {location.error ? <View accessibilityRole="alert"><Text className="text-destructive">{location.error}</Text>{location.needsLocationStop ? <Pressable accessibilityRole="button" disabled={location.busy} className="min-h-11 justify-center" onPress={() => void location.setOverall(false)}><Text className="text-primary">Turn all location off</Text></Pressable> : location.failedEnable === "sharing" && location.enabled && allowSharing ? <Pressable accessibilityRole="button" disabled={disabled} className="min-h-11 justify-center" onPress={() => setConfirm(true)}><Text className="text-primary">Retry avatar sharing</Text></Pressable> : location.failedEnable === "overall" ? <Pressable accessibilityRole="button" disabled={disabled} className="min-h-11 justify-center" onPress={() => void location.setOverall(true)}><Text className="text-primary">Retry turning location on</Text></Pressable> : null}<Pressable accessibilityRole="button" className="min-h-11 justify-center" onPress={() => void location.refresh()}><Text className="text-primary">Reload settings</Text></Pressable></View> : null}
    {!allowSharing ? <Text className="mt-2 text-muted-foreground">People map is unavailable. No map location is collected.</Text> : null}
  </View>;
}
