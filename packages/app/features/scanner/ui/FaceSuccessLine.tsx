import { Text } from "react-native";
import { COPY } from "./copy";
import { getRandom } from "./getRandomCopy";
import { usePreferencesStore } from "@dvnt/app/lib/stores/usePreferencesStore";

export function FaceSuccessLine() {
  const { locale } = usePreferencesStore();
  const line = getRandom(COPY[locale].success);
  return <Text className="text-base text-center text-foreground">{line}</Text>;
}
