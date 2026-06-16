import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

export default function CommentsBaseScreen() {
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      requestAnimationFrame(() => {
        router.dismiss();
      });
    }, [router]),
  );

  return <View style={{ flex: 1, backgroundColor: "transparent" }} />;
}
