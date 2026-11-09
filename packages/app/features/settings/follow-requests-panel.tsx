import { View, Text, Pressable } from "react-native";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
export function FollowRequestsPanel() {
  const owner = useAuthStore(s => s.user?.id);
  return owner ? <Requests key={owner} /> : null;
}
function Requests() {
  const { query, mutation } = useFollowRequests();
  return <View className="mt-4 rounded-xl border border-border bg-card p-4">
    <Text className="font-semibold text-foreground">Follow requests</Text>
    <Text className="mt-1 text-sm text-muted-foreground">Approve members to let them see your private posts. Existing followers need your approval too.</Text>
    {query.isLoading ? <Text className="text-muted-foreground">Loading requests…</Text> : query.isError ? <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text className="text-destructive">Could not load requests. Retry</Text></Pressable> : query.data?.length ? query.data.map(request => <View key={request.follower_id} className="flex-row items-center gap-3 border-t border-border py-3">
      <Text className="flex-1 text-foreground">{request.requester?.username || "Member"}</Text>
      <Pressable accessibilityRole="button" className="rounded-lg bg-primary p-3" disabled={mutation.isPending} onPress={() => mutation.mutate({ requesterId: String(request.follower_id), action: "approve" })}><Text className="text-primary-foreground">Approve</Text></Pressable>
      <Pressable accessibilityRole="button" className="rounded-lg border border-border p-3" disabled={mutation.isPending} onPress={() => mutation.mutate({ requesterId: String(request.follower_id), action: "decline" })}><Text className="text-foreground">Decline</Text></Pressable>
    </View>) : <Text className="mt-3 text-muted-foreground">No pending requests.</Text>}
    {mutation.isError ? <Text accessibilityRole="alert" className="text-destructive">{mutation.error.message}</Text> : null}
  </View>;
}
