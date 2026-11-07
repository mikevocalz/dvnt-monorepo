import { View, Text, Pressable } from "react-native";
import { Radio } from "lucide-react-native";
import { usePendingCohostInvites } from "@dvnt/app/lib/hooks/use-lynk-cohost-invites";
import { useCohostInviteActions } from "../hooks/useCohostInviteActions";

/** Native counterpart of the durable web Activity invitation cards. */
export function PendingCohostInvites() {
  const query = usePendingCohostInvites();
  const { accept, decline, pending, variables } = useCohostInviteActions("native");
  const invites = query.data ?? [];
  if (!query.isError && invites.length === 0) return null;
  return (
    <View accessibilityLabel="Co-host invitations" style={{ gap: 12, marginBottom: 16 }}>
      {query.isError && <View className="rounded-2xl border border-border p-4">
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">Co-host invitations couldn't refresh. Try again to see what's current.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry invitations" disabled={query.isFetching}
          accessibilityState={{ disabled: query.isFetching, busy: query.isFetching }} onPress={() => { void query.refetch(); }}
          style={{ minHeight: 44, justifyContent: "center", marginTop: 8 }}>
          <Text style={{ color: "#3FDCFF", fontWeight: "600" }}>{query.isFetching ? "Refreshing…" : "Retry invitations"}</Text>
        </Pressable>
      </View>}
      {invites.map((invite) => {
        const title = invite.roomTitle || "Live Lynk";
        const responding = pending && variables?.inviteId === invite.id;
        return <View key={invite.id} className="rounded-2xl border border-border bg-card p-4">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(63,220,255,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Radio size={18} color="#3FDCFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text className="text-base font-semibold text-foreground">Invitation to co-host</Text>
              <Text className="text-sm text-muted-foreground" style={{ marginTop: 2 }}>{title}</Text>
            </View>
          </View>
          <Text className="text-xs text-muted-foreground" style={{ lineHeight: 19, marginTop: 10 }}>Help manage the room. Your existing room identity stays the same. New members use their profile. Review your camera and microphone before joining. Room limits still apply.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Accept co-host invitation to ${title}`}
              accessibilityState={{ disabled: pending, busy: responding && variables?.action === "accept" }}
              disabled={pending} onPress={() => accept(invite)}
              style={{ minHeight: 44, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", backgroundColor: "#3FDCFF", opacity: pending ? 0.5 : 1 }}>
              <Text style={{ color: "#06070D", fontWeight: "700" }}>{responding && variables?.action === "accept" ? "Accepting…" : "Accept & review"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Decline co-host invitation to ${title}`}
              accessibilityState={{ disabled: pending, busy: responding && variables?.action === "decline" }}
              disabled={pending} onPress={() => decline(invite)}
              className="border border-border" style={{ minHeight: 44, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", opacity: pending ? 0.5 : 1 }}>
              <Text className="text-foreground font-semibold">{responding && variables?.action === "decline" ? "Declining…" : "Decline"}</Text>
            </Pressable>
          </View>
        </View>;
      })}
    </View>
  );
}
