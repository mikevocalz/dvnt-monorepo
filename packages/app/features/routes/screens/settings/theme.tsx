import { View, Text, ScrollView, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { Sun, Moon, Smartphone, Check } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import { useEffect, useState, useLayoutEffect } from "react";

type ThemeOption = "system" | "light" | "dark";
const THEME_STORAGE_KEY = "app_theme_preference";

export default function ThemeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, colorScheme, setColorScheme } = useColorScheme();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("system");

  useEffect(() => {
    const stored = mmkv.getString(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setSelectedTheme(stored);
    }
  }, []);

  const handleSelectTheme = (theme: ThemeOption) => {
    setSelectedTheme(theme);
    mmkv.set(THEME_STORAGE_KEY, theme);
    setColorScheme(theme as Parameters<typeof setColorScheme>[0]);
  };

  const themes: {
    id: ThemeOption;
    label: string;
    description: string;
    Icon: typeof Sun;
  }[] = [
    {
      id: "system",
      label: "System",
      description: "Match your device settings",
      Icon: Smartphone,
    },
    {
      id: "light",
      label: "Light",
      description: "Always use light mode",
      Icon: Sun,
    },
    {
      id: "dark",
      label: "Dark",
      description: "Always use dark mode",
      Icon: Moon,
    },
  ];

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Theme",
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
          <View className="rounded-lg border border-border bg-card">
            {themes.map((theme, index) => (
              <View key={theme.id}>
                {index > 0 && <View className="mx-4 h-px bg-border" />}
                <Pressable
                  onPress={() => handleSelectTheme(theme.id)}
                  className="flex-row items-center p-4 active:bg-secondary/50"
                >
                  <View className="mr-4 rounded-full bg-secondary/50 p-2">
                    <theme.Icon size={20} color={colors.foreground} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">
                      {theme.label}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      {theme.description}
                    </Text>
                  </View>
                  {selectedTheme === theme.id && (
                    <Check size={20} color={colors.primary} />
                  )}
                </Pressable>
              </View>
            ))}
          </View>

          <View className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Theme changes apply immediately and are saved automatically.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
