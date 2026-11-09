import { useExactDistanceConsent } from "@dvnt/app/lib/hooks/use-exact-distance-consent";
import { EXACT_DISTANCE_COPY } from "@dvnt/app/lib/stores/exact-distance-store";
/**
 * City discovery visibility — the settings control, native (iOS + Android).
 *
 * Two settings sit next to each other on purpose. "Use my location to find
 * events" is `locationMode` and lives on the Events screen. This card is the
 * other one: whether other members can see the city. It is off until the member
 * turns it on, it ends by itself, and it can be turned off in one tap.
 *
 * Nothing here reads a ticket or an RSVP. The grant is a city name and an end
 * time, which is why a private event a member holds a ticket to cannot become a
 * discovery signal through this surface.
 */

import { View, Text, Pressable } from "react-native";
import { Switch } from "@dvnt/app/components/ui/switch";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useSyncMemberProximityPresence } from "@dvnt/app/lib/hooks/use-member-proximity";
import {
  useEventsLocationStore,
  useActiveCityVisibility,
} from "@dvnt/app/lib/stores/events-location-store";
import {
  CITY_VISIBILITY_COPY as COPY,
  PRECISE_PROXIMITY_COPY as PROXIMITY_COPY,
  formatVisibilityExpiry,
  VISIBILITY_DURATIONS,
} from "@dvnt/app/lib/stores/city-discovery-visibility";

export function CityVisibilityCard() {
  // Native privacy settings commit explicit publish/revoke while the screen is visible.
  const proximity = useSyncMemberProximityPresence();
  const exact = useExactDistanceConsent();
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const durationId = useEventsLocationStore((s) => s.visibilityDurationId);
  const setDuration = useEventsLocationStore((s) => s.setVisibilityDuration);
  const showMeInCity = useEventsLocationStore((s) => s.showMeInCity);
  const hideMeInCity = () => proximity.stop(true);
  const preciseOptIn = useEventsLocationStore((s) => s.preciseProximityGrant);
  const preciseOwner = useEventsLocationStore((s) => s.preciseProximityOwnerAuthId);
  const authId = useAuthStore((s) => s.user?.authId);
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);
  const grant = useActiveCityVisibility();
  const hasDeviceLocation = Number.isFinite(deviceLat) && Number.isFinite(deviceLng);

  const onToggle = (next: boolean) => {
    if (!next) return hideMeInCity();
    if (activeCity) showMeInCity(activeCity);
  };

  return (
    <View className="mb-6 rounded-xl border border-border bg-card">
      <View className="p-4">
        <Text className="text-sm text-muted-foreground">{EXACT_DISTANCE_COPY}</Text>
        {!exact.enabled && !exact.withdrawalPending && (!grant || !hasDeviceLocation || !preciseOptIn || preciseOwner !== authId || proximity.withdrawalPending) ? (
          <Text className="mt-2 text-sm text-muted-foreground">To allow exact distances, turn on city visibility and approximate distance sharing below, and make a device location available first. Exact sharing asks separately and gets a fresh location.</Text>
        ) : null}
        <Pressable accessibilityRole="button" disabled={exact.busy || (!exact.enabled && !exact.withdrawalPending && (!grant || !hasDeviceLocation || !preciseOptIn || preciseOwner !== authId || proximity.withdrawalPending))}
          onPress={() => void exact.update(!(exact.enabled || exact.withdrawalPending))} className="mt-3 rounded-full border border-border px-4 py-2">
          <Text className="text-foreground">{exact.busy ? (exact.withdrawalPending ? "Stopping…" : "Getting a fresh location…") : exact.withdrawalPending ? "Retry Stop exact distances" : exact.enabled ? "Stop exact distances" : "I agree: allow exact distances"}</Text>
        </Pressable>
        {exact.error ? <Text accessibilityRole="alert" className="text-red-500">{exact.error}</Text> : null}
      </View>
      <View className="flex-row items-center justify-between p-4">
        <View className="flex-1 pr-4">
          <Text className="font-semibold text-foreground">
            {COPY.toggleLabel}
          </Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            {COPY.toggleDescription}
          </Text>
        </View>
        <Switch
          checked={grant != null}
          disabled={grant == null && (!activeCity || proximity.withdrawalPending)}
          onCheckedChange={onToggle}
        />
      </View>

      <View className="mx-4 h-px bg-border" />

      <View className="p-4">
        <Text className="text-sm font-medium text-foreground">
          {COPY.durationLabel}
        </Text>
        <View className="mt-3 flex-row gap-2">
          {VISIBILITY_DURATIONS.map((d) => {
            const selected = d.id === durationId;
            return (
              <Pressable
                key={d.id}
                onPress={() => setDuration(d.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`rounded-full border px-4 py-2 ${
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-transparent"
                }`}
              >
                <Text
                  className={`text-sm ${
                    selected ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {grant ? (
          <View className="mt-4">
            <Text className="text-sm text-muted-foreground">
              Members can see you are in {grant.cityName} until{" "}
              {formatVisibilityExpiry(grant.expiresAt, Date.now())}. It turns
              itself off then.
            </Text>
            <Pressable
              onPress={hideMeInCity}
              accessibilityRole="button"
              className="mt-3 self-start rounded-full border border-border px-4 py-2"
            >
              <Text className="text-sm font-medium text-foreground">
                {COPY.revoke}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text className="mt-4 text-sm text-muted-foreground">
            {activeCity ? COPY.offNote : COPY.noCity}
          </Text>
        )}
      </View>
      <View className="mx-4 h-px bg-border" />
      <View className="flex-row items-center justify-between p-4">
        <View className="flex-1 pr-4">
          <Text className="font-semibold text-foreground">
            {PROXIMITY_COPY.toggleLabel}
          </Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            {PROXIMITY_COPY.toggleDescription}
          </Text>
          {!grant || !hasDeviceLocation ? (
            <Text className="mt-2 text-xs text-muted-foreground">
              {PROXIMITY_COPY.unavailable}
            </Text>
          ) : null}
        </View>
        <Switch
          checked={Boolean(grant && preciseOptIn && preciseOwner === authId)}
          disabled={proximity.withdrawalPending || ((!grant || !hasDeviceLocation) && preciseOwner !== authId)}
          onCheckedChange={proximity.setDistanceSharing}
        />
      </View>
      {proximity.busy ? <Text accessibilityLiveRegion="polite" className="px-4 pb-3 text-sm text-muted-foreground">{proximity.withdrawalPending ? "Stopping distance sharing…" : "Updating distance sharing…"}</Text> : null}
      {proximity.error ? <Text accessibilityRole="alert" className="px-4 pb-3 text-sm text-red-500">{proximity.error}</Text> : null}
      {proximity.error || proximity.withdrawalPending ? (
        <Pressable accessibilityRole="button" disabled={proximity.busy} onPress={() => void proximity.retry()}
          className="mx-4 mb-4 self-start rounded-full border border-border px-4 py-2">
          <Text className="text-sm text-foreground">{proximity.withdrawalPending ? "Retry Stop sharing distance" : "Retry distance sharing"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
