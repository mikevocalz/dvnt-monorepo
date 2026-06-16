import { View, Text, ScrollView, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { CloudRain, Snowflake, Sun } from "lucide-react-native";
import { useLayoutEffect } from "react";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { Switch } from "@dvnt/app/components/ui/switch";
import { useWeatherFXStore } from "@dvnt/app/src/features/weatherfx/WeatherFXStore";
export default function WeatherAmbianceScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();

  const weatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.weatherAmbianceEnabled,
  );
  const setWeatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.setWeatherAmbianceEnabled,
  );
  const effectIntensityScale = useWeatherFXStore((s) => s.effectIntensityScale);
  const setEffectIntensityScale = useWeatherFXStore(
    (s) => s.setEffectIntensityScale,
  );

  // Intensity presets: Low (0.3), Medium (0.6), High (1.0)
  const presets = [
    { label: "Low", value: 0.3 },
    { label: "Medium", value: 0.6 },
    { label: "High", value: 1.0 },
  ] as const;

  const activePreset = presets.reduce((prev, curr) =>
    Math.abs(curr.value - effectIntensityScale) <
    Math.abs(prev.value - effectIntensityScale)
      ? curr
      : prev,
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Weather Ambiance",
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: colors.foreground,
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => <SettingsCloseButton />,
    });
  }, [navigation, colors]);

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand color legend */}
          <View className="mb-6 flex-row items-center justify-center gap-6">
            <View className="items-center">
              <View
                className="h-8 w-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(138, 64, 207, 0.15)" }}
              >
                <CloudRain size={16} color="#8A40CF" />
              </View>
              <Text className="mt-1 text-[10px] text-muted-foreground">
                Rain
              </Text>
            </View>
            <View className="items-center">
              <View
                className="h-8 w-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(63, 220, 255, 0.15)" }}
              >
                <Snowflake size={16} color="#3FDCFF" />
              </View>
              <Text className="mt-1 text-[10px] text-muted-foreground">
                Snow
              </Text>
            </View>
            <View className="items-center">
              <View
                className="h-8 w-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(252, 37, 58, 0.15)" }}
              >
                <Sun size={16} color="#FC253A" />
              </View>
              <Text className="mt-1 text-[10px] text-muted-foreground">
                Sunny
              </Text>
            </View>
          </View>

          {/* Master toggle */}
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Weather Effects
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Show cinematic weather effects and ambient sounds on the
                  Events tab based on real-time weather
                </Text>
              </View>
              <Switch
                checked={weatherAmbianceEnabled}
                onCheckedChange={setWeatherAmbianceEnabled}
              />
            </View>
          </View>

          {/* Intensity selector */}
          {weatherAmbianceEnabled && (
            <>
              <Text className="mb-3 text-sm font-semibold text-muted-foreground">
                EFFECT INTENSITY
              </Text>
              <View className="mb-6 rounded-xl border border-border bg-card p-4">
                <View className="flex-row gap-3">
                  {presets.map((preset) => {
                    const isActive = activePreset.label === preset.label;
                    return (
                      <Pressable
                        key={preset.label}
                        onPress={() => setEffectIntensityScale(preset.value)}
                        className={`flex-1 items-center rounded-2xl py-3 ${
                          isActive
                            ? "bg-primary"
                            : "border border-border bg-card"
                        }`}
                      >
                        <Text
                          className={`text-sm font-semibold ${
                            isActive
                              ? "text-primary-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="mt-3 text-xs text-muted-foreground">
                  Controls particle density, audio volume, and post-processing
                  intensity. Low is recommended for older devices.
                </Text>
              </View>

              <Text className="mb-3 text-sm font-semibold text-muted-foreground">
                ABOUT
              </Text>
              <View className="mb-6 rounded-xl border border-border bg-card p-4">
                <Text className="text-sm text-muted-foreground leading-5">
                  Weather effects use your device GPU for smooth, cinematic
                  visuals. Effects automatically disable when:{"\n\n"}
                  {"\u2022"} Reduce Motion is enabled in system settings{"\n"}
                  {"\u2022"} Low Power Mode is active{"\n"}
                  {"\u2022"} Battery drops below 20%{"\n\n"}A cinematic intro
                  plays once per day when you first open the Events tab with
                  active weather.
                </Text>
              </View>
            </>
          )}

          <View className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Changes are saved automatically and persist across sessions.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
