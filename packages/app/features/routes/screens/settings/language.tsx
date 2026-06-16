import { View, Text, ScrollView, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { Check } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useEffect, useState, useLayoutEffect } from "react";
import { toast } from "sonner-native";
import { useTranslation } from "react-i18next";
import {
  supportedLanguages,
  changeLanguage,
  getCurrentLanguage,
} from "@dvnt/app/lib/i18n";

export default function LanguageScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { t, i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] =
    useState(getCurrentLanguage());

  useEffect(() => {
    setSelectedLanguage(i18n.language);
  }, [i18n.language]);

  const handleSelectLanguage = async (code: string) => {
    const success = changeLanguage(code);
    if (success) {
      setSelectedLanguage(code);
      toast.success(t("settings.language"), {
        description: t("common.save"),
      });
    } else {
      toast.error(t("common.error"));
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t("settings.language"),
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
  }, [navigation, colors, t]);

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          <Text className="mb-3 text-sm text-muted-foreground">
            {t("settings.systemDefault")}
          </Text>

          <View className="rounded-lg border border-border bg-card">
            {supportedLanguages.map(
              (language: (typeof supportedLanguages)[0], index: number) => (
                <View key={language.code}>
                  {index > 0 && <View className="mx-4 h-px bg-border" />}
                  <Pressable
                    onPress={() => handleSelectLanguage(language.code)}
                    className="flex-row items-center justify-between p-4 active:bg-secondary/50"
                  >
                    <View>
                      <Text className="font-semibold text-foreground">
                        {language.name}
                      </Text>
                      <Text className="text-sm text-muted-foreground">
                        {language.native}
                      </Text>
                    </View>
                    {selectedLanguage === language.code && (
                      <Check size={20} color={colors.primary} />
                    )}
                  </Pressable>
                </View>
              ),
            )}
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
