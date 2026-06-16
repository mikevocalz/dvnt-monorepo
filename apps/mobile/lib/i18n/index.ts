import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import { mmkv } from "@/lib/mmkv-zustand";

import en from "./translations/en.json";
import es from "./translations/es.json";
import fr from "./translations/fr.json";
import ja from "./translations/ja.json";
import pt from "./translations/pt.json";
import zh from "./translations/zh.json";

const LANGUAGE_STORAGE_KEY = "app_language_preference";

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  ja: { translation: ja },
  pt: { translation: pt },
  zh: { translation: zh },
};

const getStoredLanguage = (): string => {
  const stored = mmkv.getString(LANGUAGE_STORAGE_KEY);
  if (stored && resources[stored as keyof typeof resources]) {
    return stored;
  }
  const locales = getLocales();
  const systemLang = locales[0]?.languageCode ?? "en";
  if (resources[systemLang as keyof typeof resources]) {
    return systemLang;
  }
  return "en";
};

export const supportedLanguages = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "pt", name: "Portuguese (Brazil)", native: "Português (Brasil)" },
  { code: "zh", name: "Chinese", native: "中文" },
];

export const changeLanguage = (lang: string) => {
  if (resources[lang as keyof typeof resources]) {
    i18n.changeLanguage(lang);
    mmkv.set(LANGUAGE_STORAGE_KEY, lang);
    return true;
  }
  return false;
};

export const getCurrentLanguage = () => i18n.language;

i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
