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
import {
  useEventsLocationStore,
  useActiveCityVisibility,
} from "@dvnt/app/lib/stores/events-location-store";
import {
  CITY_VISIBILITY_COPY as COPY,
  formatVisibilityExpiry,
  VISIBILITY_DURATIONS,
} from "@dvnt/app/lib/stores/city-discovery-visibility";

export function CityVisibilityCard() {
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const durationId = useEventsLocationStore((s) => s.visibilityDurationId);
  const setDuration = useEventsLocationStore((s) => s.setVisibilityDuration);
  const showMeInCity = useEventsLocationStore((s) => s.showMeInCity);
  const hideMeInCity = useEventsLocationStore((s) => s.hideMeInCity);
  const grant = useActiveCityVisibility();

  const onToggle = (next: boolean) => {
    if (!next) return hideMeInCity();
    if (activeCity) showMeInCity(activeCity);
  };

  return (
    <View className="mb-6 rounded-xl border border-border bg-card">
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
          disabled={!activeCity && grant == null}
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
    </View>
  );
}
