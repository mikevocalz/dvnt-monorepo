import { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { postPublishQueue } from "@dvnt/app/lib/posts/publish-queue";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { usePublishQueueResume } from "@dvnt/app/lib/hooks/use-publish-post";

export function PostUploadStatus() {
  usePublishQueueResume();
  const jobs = useSyncExternalStore(postPublishQueue.subscribe, postPublishQueue.getSnapshot, postPublishQueue.getSnapshot);
  const owner = useAuthStore((state) => state.user);
  return <View>{jobs.filter((job) => job.ownerId === String(owner?.id) || job.ownerId === owner?.authId).map((job) => (
    <View key={job.id} accessibilityLiveRegion="polite" style={{ marginHorizontal: 12, marginVertical: 5, padding: 12, borderRadius: 12, backgroundColor: "#161c29", flexDirection: "row", alignItems: "center", gap: 12 }}>
      {job.status !== "failed" && <ActivityIndicator color="#22d3ee" />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "white", fontWeight: "600" }}>{job.status === "failed" ? "Post not shared" : job.resumed ? "Interrupted post, picked back up" : job.label}</Text>
        <Text style={{ color: "#bbc3cf", marginTop: 3 }}>{job.message}</Text>
      </View>
      {job.status === "failed" && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry sharing post" hitSlop={8} onPress={() => postPublishQueue.retry(job.id)}><Text style={{ color: "#22d3ee", padding: 8 }}>Retry</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss failed post" hitSlop={8} onPress={() => postPublishQueue.dismiss(job.id)}><Text style={{ color: "#bbc3cf", padding: 8 }}>Dismiss</Text></Pressable>
      </>}
    </View>
  ))}</View>;
}
