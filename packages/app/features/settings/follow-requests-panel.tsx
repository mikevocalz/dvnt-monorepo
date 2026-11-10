import { useRef, useSyncExternalStore } from "react";
import {
  getSessionLifecycle,
  subscribeSessionLifecycle,
} from "@dvnt/app/lib/auth/session-lifecycle";
import {
  getFollowIdentityRevision,
  subscribeFollowIdentityRevision,
} from "@dvnt/app/lib/auth/follow-identity";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function FollowRequestsPanel() {
  const owner = useAuthStore((s) => s.user?.id);
  const session = useSyncExternalStore(
    subscribeSessionLifecycle,
    getSessionLifecycle,
    getSessionLifecycle,
  );
  const revision = useSyncExternalStore(
    subscribeFollowIdentityRevision,
    getFollowIdentityRevision,
    getFollowIdentityRevision,
  );
  return owner ? (
    <Requests key={`${owner}:${session.epoch}:${revision}`} />
  ) : null;
}

function Requests() {
  const router = useRouter();
  const { query, mutation } = useFollowRequests();
  const inFlight = useRef(false);

  const respond = async (
    requesterId: string,
    action: "approve" | "decline",
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await mutation.mutateAsync({ requesterId, action });
    } catch {
      // The mutation error is shown below, and the request stays available to retry.
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <View className="my-4 rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text
          accessibilityRole="header"
          className="font-semibold text-foreground"
        >
          Follow requests
        </Text>
        {!query.isError && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh follow requests"
            accessibilityState={{
              disabled: query.isFetching || mutation.isPending,
              busy: query.isFetching,
            }}
            disabled={query.isFetching || mutation.isPending}
            onPress={() => void query.refetch()}
            className="min-h-11 justify-center rounded-lg px-3 disabled:opacity-50"
          >
            <Text className="text-sm text-primary">
              {query.isFetching && !query.isLoading ? "Refreshing…" : "Refresh"}
            </Text>
          </Pressable>
        )}
      </View>
      <Text className="mt-1 text-sm text-muted-foreground">
        Approve new follow requests to let members see your private posts.
        Existing followers keep their access, including when you switch from
        Public to Private. If they unfollow or are removed, they will need your
        approval to follow again while your account is Private.
      </Text>
      {query.isLoading ? (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-3 text-muted-foreground"
        >
          Loading requests…
        </Text>
      ) : query.isError ? (
        <View className="mt-3">
          <Text accessibilityRole="alert" className="text-destructive">
            Could not load requests. Please try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading follow requests"
            accessibilityState={{
              disabled: query.isFetching,
              busy: query.isFetching,
            }}
            disabled={query.isFetching}
            onPress={() => void query.refetch()}
            className="min-h-11 justify-center rounded-lg px-3 disabled:opacity-50"
          >
            <Text className="text-primary">
              {query.isFetching ? "Retrying…" : "Retry"}
            </Text>
          </Pressable>
        </View>
      ) : query.data?.length ? (
        query.data.map((request) => {
          const requesterId = String(request.follower_id);
          const username = request.requester?.username;
          const label = username || "Member";
          const pending =
            mutation.isPending &&
            mutation.variables?.requesterId === requesterId;
          return (
            <View
              key={requesterId}
              className="mt-3 flex-row flex-wrap items-center gap-3 border-t border-border py-3"
            >
              {username ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`View ${username}'s profile`}
                  className="min-h-11 min-w-0 flex-1 justify-center"
                  onPress={() =>
                    router.push(
                      `/profile/${encodeURIComponent(username)}` as any,
                    )
                  }
                >
                  <Text className="text-primary">{username}</Text>
                </Pressable>
              ) : (
                <Text className="flex-1 text-foreground">{label}</Text>
              )}
              <View className="flex-row gap-2">
                {(["approve", "decline"] as const).map((action) => {
                  const busy = pending && mutation.variables?.action === action;
                  const text = action === "approve" ? "Approve" : "Decline";
                  return (
                    <Pressable
                      key={action}
                      accessibilityRole="button"
                      accessibilityLabel={`${text} ${label}'s follow request`}
                      accessibilityState={{
                        disabled: mutation.isPending,
                        busy,
                      }}
                      disabled={mutation.isPending}
                      onPress={() => void respond(requesterId, action)}
                      className={`min-h-11 justify-center rounded-lg p-3 disabled:opacity-50 ${action === "approve" ? "bg-primary" : "border border-border"}`}
                    >
                      <Text
                        className={
                          action === "approve"
                            ? "text-primary-foreground"
                            : "text-foreground"
                        }
                      >
                        {busy
                          ? action === "approve"
                            ? "Approving…"
                            : "Declining…"
                          : text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })
      ) : (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-3 text-muted-foreground"
        >
          No pending requests. New follow requests will appear here.
        </Text>
      )}
      {mutation.isPending && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 text-sm text-muted-foreground"
        >
          {mutation.variables?.action === "approve"
            ? "Approving request…"
            : "Declining request…"}
        </Text>
      )}
      {mutation.isSuccess && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 text-sm text-muted-foreground"
        >
          {mutation.variables?.action === "approve"
            ? "Request approved."
            : "Request declined."}
        </Text>
      )}
      {mutation.isError && (
        <Text
          accessibilityRole="alert"
          className="mt-2 text-sm text-destructive"
        >
          Could not{" "}
          {mutation.variables?.action === "approve" ? "approve" : "decline"}{" "}
          request. {mutation.error?.message} Please try again.
        </Text>
      )}
    </View>
  );
}
