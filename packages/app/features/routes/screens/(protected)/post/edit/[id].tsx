/**
 * Edit Post Screen (Legacy Route)
 *
 * Redirects to the canonical edit-post/[id] route.
 * Route: /(protected)/post/edit/[id]
 */

import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function EditPostRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id) {
      router.replace(`/(protected)/edit-post/${id}` as any);
    } else {
      router.back();
    }
  }, [id, router]);

  return (
    <View className="flex-1 bg-background items-center justify-center">
      <ActivityIndicator size="large" color="#8A40CF" />
    </View>
  );
}
