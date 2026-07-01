import {
  View,
  Text,
  Pressable,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
  useWindowDimensions,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import {
  LegendList,
  type LegendListRenderItemProps,
} from "@dvnt/app/components/list";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  ArrowLeft,
  Edit,
  MessageSquare,
  Inbox,
  ShieldAlert,
  Users,
  Radio,
  Plus,
  Trash2,
} from "lucide-react-native";
import { Image } from "expo-image";
import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { MessagesSkeleton } from "@dvnt/app/components/skeletons";
import { EmptyState } from "@dvnt/app/components/ui/empty-state";
import { Button } from "@dvnt/app/components/ui/button";
import { type Conversation } from "@dvnt/app/lib/api/messages";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  useUnreadMessageCount,
  useFilteredConversations,
  messageKeys,
  useRefreshMessageCounts,
} from "@dvnt/app/lib/hooks/use-messages";
import { useQueryClient } from "@tanstack/react-query";
import { navigateToChat } from "@dvnt/app/lib/navigation/chat-routes";
import { usePresenceStore } from "@dvnt/app/lib/stores/presence-store";
import { useUserPresence } from "@dvnt/app/lib/hooks/use-presence";
import PagerView from "react-native-pager-view";
import {
  useLynkHistoryStore,
  type LynkRecord,
} from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { LiveRoomCard } from "@dvnt/app/src/sneaky-lynk/ui/LiveRoomCard";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/src/sneaky-lynk/hooks/useSneakyLynkCaptureProtection";
import { useFocusEffect } from "expo-router";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useScreenTrace } from "@dvnt/app/lib/perf/screen-trace";
import { useBootstrapMessages } from "@dvnt/app/lib/hooks/use-bootstrap-messages";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { useChatStore } from "@dvnt/app/lib/stores/chat-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";
import { useUnreadCountsStore } from "@dvnt/app/lib/stores/unread-counts-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";

interface ConversationItem {
  id: string;
  oderpantId: string;
  user: { username: string; name: string; avatar: string };
  lastMessage: string;
  timeAgo: string;
  unread: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: Array<{
    id: string;
    authId?: string;
    username: string;
    avatar: string;
  }>;
}

function GroupAvatarStack({
  members,
  onPress,
}: {
  members: Array<{ id: string; username: string; avatar: string }>;
  onPress: () => void;
}) {
  const previewMembers = members.slice(0, 4);
  const inset = 5;

  return (
    <Pressable onPress={onPress} style={conversationListStyles.groupAvatarWrap}>
      <View style={conversationListStyles.groupAvatarStack}>
        {previewMembers.map((member, idx) => {
          const positions = [
            { top: inset, left: inset },
            { top: inset, right: inset },
            { bottom: inset, left: inset },
            { bottom: inset, right: inset },
          ] as const;
          const position = positions[idx] ?? positions[0];

          return (
            <View
              key={member.id || `${member.username}-${idx}`}
              style={[
                conversationListStyles.groupAvatarTile,
                position,
                { zIndex: previewMembers.length - idx },
              ]}
            >
              <Avatar
                uri={member.avatar}
                username={member.username}
                size={21}
                variant="roundedSquare"
              />
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

function PresenceDot({ oderpantId }: { oderpantId: string }) {
  const { isOnline } = useUserPresence(oderpantId);
  if (!isOnline) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: "#22C55E",
        borderWidth: 2,
        borderColor: "#000",
      }}
    />
  );
}

function formatTimeAgo(dateString?: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function ConversationRow({
  item,
  onChatPress,
  onProfilePress,
  onMarkAsRead,
  onDeleteConversation,
  currentUser,
  isDeleting,
}: {
  item: ConversationItem;
  onChatPress: (id: string, item?: ConversationItem) => void;
  onProfilePress: (username: string) => void;
  onMarkAsRead?: (id: string) => void;
  onDeleteConversation?: (item: ConversationItem) => void;
  currentUser: ReturnType<typeof useAuthStore.getState>["user"];
  isDeleting?: boolean;
}) {
  const swipeableRef = useRef<any>(null);
  const isGroup = !!item.isGroup;
  const stackMembers =
    isGroup && item.members
      ? (() => {
          const currentUserAuthId = currentUser?.authId || currentUser?.id;
          const alreadyIncludesCurrentUser = item.members.some(
            (member) =>
              (currentUserAuthId &&
                (member.authId === currentUserAuthId ||
                  member.id === currentUserAuthId)) ||
              (!!currentUser?.username &&
                member.username === currentUser.username),
          );

          if (!currentUser || alreadyIncludesCurrentUser) {
            return item.members;
          }

          return [
            ...item.members,
            {
              id: String(currentUser.id || currentUser.authId || "me"),
              authId: currentUser.authId || currentUser.id,
              username: currentUser.username || "you",
              avatar: currentUser.avatar || "",
            },
          ];
        })()
      : item.members || [];
  const memberCount = isGroup ? Math.max(stackMembers.length, 1) : 0;

  const confirmDelete = useCallback(() => {
    swipeableRef.current?.close?.();
    if (!onDeleteConversation || isDeleting) return;

    Alert.alert(
      isGroup ? "Leave group?" : "Delete conversation?",
      isGroup
        ? "This removes the group from your messages list. Other members keep the conversation."
        : "This removes the conversation from your messages list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isGroup ? "Leave" : "Delete",
          style: "destructive",
          onPress: () => onDeleteConversation(item),
        },
      ],
    );
  }, [isDeleting, isGroup, item, onDeleteConversation]);

  return (
    <View style={conversationListStyles.rowWrap}>
      <ReanimatedSwipeable
        ref={swipeableRef}
        enabled={!!onDeleteConversation && !isDeleting}
        overshootRight={false}
        rightThreshold={42}
        friction={2}
        renderRightActions={() => (
          <View style={conversationListStyles.deleteActionWrap}>
            <Pressable
              onPress={confirmDelete}
              disabled={isDeleting}
              style={[
                conversationListStyles.deleteActionButton,
                isDeleting
                  ? conversationListStyles.deleteActionButtonDisabled
                  : null,
              ]}
            >
              <Trash2 size={18} color="#fff" />
              <Text style={conversationListStyles.deleteActionText}>
                {isDeleting ? "Deleting" : "Delete"}
              </Text>
            </Pressable>
          </View>
        )}
      >
        <View
          style={[
            conversationListStyles.rowCard,
            isGroup
              ? conversationListStyles.rowCardGroup
              : conversationListStyles.rowCardDirect,
            item.unread ? conversationListStyles.rowCardUnread : null,
            isDeleting ? conversationListStyles.rowCardDeleting : null,
          ]}
        >
          {isGroup && stackMembers.length > 1 ? (
            <GroupAvatarStack
              members={stackMembers}
              onPress={() => onChatPress(item.id, item)}
            />
          ) : (
            <Pressable onPress={() => onProfilePress(item.user.username)}>
              <View style={conversationListStyles.directAvatarWrap}>
                <Avatar
                  uri={item.user.avatar}
                  username={item.user.username}
                  size={56}
                  variant="roundedSquare"
                />
                <PresenceDot oderpantId={item.oderpantId} />
              </View>
            </Pressable>
          )}

          <TouchableOpacity
            onPress={() => onChatPress(item.id, item)}
            onLongPress={() => {
              if (item.unread && onMarkAsRead) onMarkAsRead(item.id);
            }}
            delayLongPress={400}
            activeOpacity={0.8}
            style={conversationListStyles.rowContent}
            disabled={isDeleting}
          >
            <View style={conversationListStyles.rowTop}>
              <View style={conversationListStyles.titleBlock}>
                <View style={conversationListStyles.titleRow}>
                  {isGroup ? (
                    <>
                      <View style={conversationListStyles.groupBadge}>
                        <Users size={12} color="#CFA8FF" />
                        <Text style={conversationListStyles.groupBadgeText}>
                          Group
                        </Text>
                      </View>
                      <Text
                        style={[
                          conversationListStyles.titleText,
                          item.unread && conversationListStyles.titleTextUnread,
                        ]}
                        numberOfLines={1}
                      >
                        {item.groupName || item.user.username}
                      </Text>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => onProfilePress(item.user.username)}
                    >
                      <Text
                        style={[
                          conversationListStyles.titleText,
                          item.unread && conversationListStyles.titleTextUnread,
                        ]}
                        numberOfLines={1}
                      >
                        {item.user.username}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {isGroup ? (
                  <Text
                    style={conversationListStyles.metaText}
                    numberOfLines={1}
                  >
                    {memberCount} members
                    {item.members && item.members.length > 0
                      ? ` • ${item.members.map((m) => m.username).join(", ")}`
                      : ""}
                  </Text>
                ) : (
                  <Text
                    style={conversationListStyles.metaText}
                    numberOfLines={1}
                  >
                    {item.user.name || item.user.username} • Direct message
                  </Text>
                )}
              </View>

              <View style={conversationListStyles.metaRight}>
                <Text
                  style={[
                    conversationListStyles.timeText,
                    item.unread && conversationListStyles.timeTextUnread,
                  ]}
                >
                  {item.timeAgo}
                </Text>
                {item.unread && (
                  <View style={conversationListStyles.unreadPill}>
                    <Text style={conversationListStyles.unreadPillText}>
                      New
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <Text
              style={[
                conversationListStyles.previewText,
                item.unread && conversationListStyles.previewTextUnread,
              ]}
              numberOfLines={2}
            >
              {item.lastMessage || "No messages yet"}
            </Text>
          </TouchableOpacity>
        </View>
      </ReanimatedSwipeable>
    </View>
  );
}

// Shared conversation list component
function ConversationList({
  conversations,
  isRefreshing,
  onRefresh,
  onChatPress,
  onProfilePress,
  onMarkAsRead,
  onDeleteConversation,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  router,
  currentUser,
  deletingConversationId,
}: {
  conversations: ConversationItem[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onChatPress: (id: string, item?: ConversationItem) => void;
  onProfilePress: (username: string) => void;
  onMarkAsRead?: (id: string) => void;
  onDeleteConversation?: (item: ConversationItem) => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: typeof MessageSquare;
  router: ReturnType<typeof useRouter>;
  currentUser: ReturnType<typeof useAuthStore.getState>["user"];
  deletingConversationId?: string | null;
}) {
  const renderConversationRow = useCallback(
    ({ item }: LegendListRenderItemProps<ConversationItem>) => {
      return (
        <ConversationRow
          item={item}
          onChatPress={onChatPress}
          onProfilePress={onProfilePress}
          onMarkAsRead={onMarkAsRead}
          onDeleteConversation={onDeleteConversation}
          currentUser={currentUser}
          isDeleting={deletingConversationId === item.id}
        />
      );
    },
    [
      currentUser,
      deletingConversationId,
      onChatPress,
      onDeleteConversation,
      onMarkAsRead,
      onProfilePress,
    ],
  );

  const keyExtractor = useCallback((item: ConversationItem) => item.id, []);

  return (
    <LegendList
      data={conversations}
      keyExtractor={keyExtractor}
      renderItem={renderConversationRow}
      estimatedItemSize={88}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor="#3EA4E5"
        />
      }
      contentContainerStyle={[
        conversationListStyles.listContent,
        conversations.length === 0 && conversationListStyles.listContentEmpty,
      ] as any}
      ListEmptyComponent={
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button
              onPress={() => router.push("/(protected)/messages/new" as any)}
            >
              Start a Conversation
            </Button>
          }
        />
      }
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}

// Lynk tab content
function SneakyLynkContent({
  router,
  isActive,
}: {
  router: ReturnType<typeof useRouter>;
  isActive: boolean;
}) {
  // Protect live room list (titles, topics, participant counts).
  // Gate on isActive — PagerView pre-renders this component, and
  // preventScreenCaptureAsync is window-wide on iOS, so leaving it
  // permanently on blacks out the Messages list and Requests tab for
  // every screenshot the user takes.
  useSneakyLynkCaptureProtection({ enabled: isActive });

  const localRooms = useLynkHistoryStore((s) => s.rooms);
  const endRoom = useLynkHistoryStore((s) => s.endRoom);
  const [dbRooms, setDbRooms] = useState<LynkRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRooms = useCallback(async () => {
    try {
      const liveRooms = await sneakyLynkApi.getLiveRooms();
      const mapped: LynkRecord[] = liveRooms.map((r) => ({
        id: r.id,
        title: r.title,
        topic: r.topic,
        description: r.description,
        isLive: r.isLive,
        hasVideo: r.hasVideo,
        isPublic: r.isPublic,
        status: r.status,
        host: r.host,
        speakers: r.speakers || [],
        listeners: r.listeners || 0,
        maxParticipants: r.maxParticipants || 50,
        createdAt: r.createdAt,
        endedAt: r.endedAt,
      }));
      setDbRooms(mapped);

      // Sync: mark local rooms as ended if they're not actually live in DB
      const actuallyLiveIds = new Set(
        liveRooms.filter((r) => r.isLive).map((r) => r.id),
      );
      for (const local of localRooms) {
        if (local.isLive && !actuallyLiveIds.has(local.id)) {
          endRoom(local.id);
        }
      }
    } catch (err) {
      console.error("[SneakyLynk] Failed to fetch live rooms:", err);
    }
  }, [localRooms, endRoom]);

  // Fetch live rooms on focus
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await fetchRooms();
      })();
      return () => {
        cancelled = true;
      };
    }, [fetchRooms]),
  );

  useEffect(() => {
    if (!isActive) return;

    void fetchRooms();

    const interval = setInterval(() => {
      void fetchRooms();
    }, 10000);

    return () => clearInterval(interval);
  }, [isActive, fetchRooms]);

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRooms();
    setRefreshing(false);
  }, [fetchRooms]);

  // Merge: DB rooms take priority, then any local-only rooms for immediate
  // host visibility before the live room fetch catches up.
  // Lynks should surface in this tab only, so this tab must include the
  // public DB rooms that other users rely on to see who's live.
  const allRooms = useCallback(() => {
    const dbIds = new Set(dbRooms.map((r) => r.id));
    const localOnly = localRooms.filter(
      (r) => !dbIds.has(r.id) && r.source === "sneaky_lynk",
    );
    return [...dbRooms, ...localOnly];
  }, [dbRooms, localRooms])();

  const handleCreateLynk = useCallback(() => {
    router.push("/(protected)/sneaky-lynk/create" as any);
  }, [router]);

  const showToast = useUIStore((s) => s.showToast);

  const handleRoomPress = useCallback(
    (room: LynkRecord) => {
      if (!room.isLive || room.status === "ended") {
        showToast(
          "info",
          "Lynk Ended",
          "This Lynk has ended and can't be rejoined",
        );
        return;
      }
      // Check capacity — toast if full
      const max = room.maxParticipants || 50;
      if (room.listeners >= max) {
        showToast(
          "error",
          "Room Full",
          "This Lynk is at max capacity. Pull to refresh when a slot opens.",
        );
        return;
      }
      router.push({
        pathname: "/(protected)/sneaky-lynk/room/[id]",
        params: {
          id: room.id,
          title: room.title,
          hasVideo: room.hasVideo ? "1" : "0",
        },
      } as any);
    },
    [router, showToast],
  );

  return (
    <View style={lynkStyles.container}>
      {/* Header */}
      <View style={lynkStyles.header}>
        <View style={lynkStyles.headerLeft}>
          <Radio size={28} color="#FC253A" />
          <Text style={lynkStyles.headerTitle}>Lynks</Text>
        </View>
        <TouchableOpacity
          style={lynkStyles.createButton}
          onPress={handleCreateLynk}
        >
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {allRooms.length > 0 ? (
        <ScrollView
          contentContainerStyle={lynkStyles.liveList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#FC253A"
              colors={["#FC253A"]}
            />
          }
        >
          {allRooms.map((room) => (
            <LiveRoomCard
              key={room.id}
              space={room}
              onPress={() => handleRoomPress(room)}
            />
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={lynkStyles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#FC253A"
              colors={["#FC253A"]}
            />
          }
        >
          <View style={lynkStyles.emptyState}>
            <Radio size={48} color="#6B7280" />
            <Text style={lynkStyles.emptyTitle}>No Lynks Yet</Text>
            <Text style={lynkStyles.emptyText}>
              Start a live conversation with friends
            </Text>
            <TouchableOpacity
              style={lynkStyles.createLynkButton}
              onPress={handleCreateLynk}
            >
              <Plus size={18} color="#fff" />
              <Text style={lynkStyles.createLynkText}>Start a Lynk</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const lynkStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FC253A",
    alignItems: "center",
    justifyContent: "center",
  },
  liveList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 16,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
  createLynkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FC253A",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 8,
  },
  createLynkText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});

const conversationListStyles = StyleSheet.create<{
  listContent: ViewStyle;
  listContentEmpty: ViewStyle;
  rowWrap: ViewStyle;
  rowCard: ViewStyle;
  rowCardDirect: ViewStyle;
  rowCardGroup: ViewStyle;
  rowCardUnread: ViewStyle;
  rowCardDeleting: ViewStyle;
  directAvatarWrap: ViewStyle;
  groupAvatarWrap: ViewStyle;
  groupAvatarStack: ViewStyle;
  groupAvatarTile: ViewStyle;
  rowContent: ViewStyle;
  rowTop: ViewStyle;
  titleBlock: ViewStyle;
  titleRow: ViewStyle;
  titleText: TextStyle;
  titleTextUnread: TextStyle;
  groupBadge: ViewStyle;
  groupBadgeText: TextStyle;
  metaText: TextStyle;
  metaRight: ViewStyle;
  timeText: TextStyle;
  timeTextUnread: TextStyle;
  unreadPill: ViewStyle;
  unreadPillText: TextStyle;
  previewText: TextStyle;
  previewTextUnread: TextStyle;
  deleteActionWrap: ViewStyle;
  deleteActionButton: ViewStyle;
  deleteActionButtonDisabled: ViewStyle;
  deleteActionText: TextStyle;
}>({
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 0,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  rowWrap: {
    marginBottom: 4,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowCardDirect: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.06)",
  },
  rowCardGroup: {
    backgroundColor: "rgba(138,64,207,0.08)",
    borderColor: "rgba(138,64,207,0.18)",
  },
  rowCardUnread: {
    borderColor: "rgba(62,164,229,0.28)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  rowCardDeleting: {
    opacity: 0.68,
  },
  directAvatarWrap: {
    position: "relative",
  },
  groupAvatarWrap: {
    width: 56,
    height: 56,
  },
  groupAvatarStack: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  groupAvatarTile: {
    position: "absolute",
    width: 21,
    height: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  titleTextUnread: {
    fontWeight: "800",
  },
  groupBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    backgroundColor: "rgba(138,64,207,0.18)",
    borderWidth: 1,
    borderColor: "rgba(207,168,255,0.18)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  groupBadgeText: {
    color: "#E6D4FF",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  metaText: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "600",
  },
  metaRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  timeText: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 11,
    fontWeight: "700",
  },
  timeTextUnread: {
    color: "#8EDBFF",
  },
  unreadPill: {
    borderRadius: 12,
    backgroundColor: "rgba(62,164,229,0.18)",
    borderWidth: 1,
    borderColor: "rgba(62,164,229,0.24)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  unreadPillText: {
    color: "#B9EAFF",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  previewText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 20,
  },
  previewTextUnread: {
    color: "#fff",
  },
  deleteActionWrap: {
    width: 96,
    justifyContent: "center",
    paddingLeft: 8,
  },
  deleteActionButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#D92D20",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  deleteActionButtonDisabled: {
    backgroundColor: "rgba(217,45,32,0.72)",
  },
  deleteActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});

function MessagesScreenContent() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const insets = useSafeAreaInsets();
  // BUG REGRESSION GUARD: see /Users/mikevocalz/deviant/app/(protected)/messages.tsx
  // history (commits b1c33c55..5363c242). The previous revert went back
  // to className="flex-1 bg-background" but the outer container
  // collapses to 0 height under the Stack screen presentation in some
  // device/OS combos, leaving the screen visibly black even though the
  // accessibility tree shows full content. Forcing explicit window
  // dimensions on the outer View prevents the collapse.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const currentUser = useAuthStore((s) => s.user);
  const setMessagesUnread = useUnreadCountsStore((s) => s.setMessagesUnread);
  const setSpamUnread = useUnreadCountsStore((s) => s.setSpamUnread);
  const queryClient = useQueryClient();
  const trace = useScreenTrace("Messages");
  useBootstrapMessages();
  const refreshMessageCounts = useRefreshMessageCounts();
  const [deletingConversationId, setDeletingConversationId] = useState<
    string | null
  >(null);

  const { data: inboxUnreadCount = 0, spamCount: spamUnreadCount = 0 } =
    useUnreadMessageCount();

  // Realtime subscription for conversation list — listen for new messages
  // so last-message preview and unread status update automatically.
  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;

    const channelId = `conv-list-${currentUser.id}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          if (cancelled) return;
          const newMsg = payload.new as any;
          const convId = String(newMsg.conversation_id);
          const content = newMsg.content || "";
          const currentUserIntId = getCurrentUserIdSync();
          const isMine =
            currentUserIntId != null &&
            String(newMsg.sender_id) === String(currentUserIntId);

          // Optimistically patch conversation list cache
          queryClient.setQueriesData<any[]>(
            { queryKey: [...messageKeys.all(currentUser.id), "filtered"] },
            (old) => {
              if (!Array.isArray(old)) return old;
              return old.map((conv: any) => {
                if (String(conv.id) !== convId) return conv;
                return {
                  ...conv,
                  lastMessage: content,
                  timestamp: "Just now",
                  unread: !isMine ? true : conv.unread,
                };
              });
            },
          );

          // Refresh unread counts badge
          if (!isMine) {
            queryClient.invalidateQueries({
              queryKey: messageKeys.unreadCount(currentUser.id),
            });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, queryClient]);

  // Soft refetch on focus — only if data is stale (> 30s old)
  // Replaces aggressive invalidateQueries which forced refetch on EVERY screen focus
  useFocusEffect(
    useCallback(() => {
      const state = queryClient.getQueryState([
        ...messageKeys.all(currentUser?.id),
        "filtered",
        "primary",
      ]);
      const dataAge = state?.dataUpdatedAt
        ? Date.now() - state.dataUpdatedAt
        : Infinity;
      if (dataAge > 30_000) {
        queryClient.invalidateQueries({
          queryKey: [...messageKeys.all(currentUser?.id), "filtered"],
        });
      }
      // Always refresh unread counts on focus — clears phantom badge after markAsRead
      queryClient.invalidateQueries({
        queryKey: messageKeys.unreadCount(currentUser?.id),
      });
    }, [queryClient, currentUser?.id]),
  );

  // TanStack Query — renders from cache instantly (primed by boot prefetch)
  const {
    data: inboxRaw = [],
    isLoading: inboxLoading,
    isRefetching: inboxRefetching,
  } = useFilteredConversations("primary");
  const { data: spamRaw = [] } = useFilteredConversations("requests");

  const initialTab = useMemo(() => {
    if (tab === "requests") return 1;
    if (tab === "lynk") return 2;
    return 0;
  }, [tab]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const pagerRef = useRef<PagerView>(null);

  const transformConversation = useCallback(
    (conv: Conversation): ConversationItem | null => {
      const otherUser = conv.user;
      if (!otherUser) return null;

      return {
        id: conv.id,
        oderpantId: otherUser.id || conv.id,
        user: {
          username:
            conv.isGroup && conv.groupName
              ? conv.groupName
              : otherUser.username,
          name:
            conv.isGroup && conv.groupName
              ? conv.groupName
              : otherUser.name || otherUser.username,
          avatar: otherUser.avatar || "",
        },
        lastMessage: conv.lastMessage || "",
        timeAgo: conv.timestamp || "",
        unread: conv.unread || false,
        isGroup: conv.isGroup,
        groupName: conv.groupName,
        members: conv.members?.map((m) => ({
          id: m.id,
          authId: m.authId,
          username: m.username,
          avatar: m.avatar,
        })),
      };
    },
    [currentUser?.username],
  );

  const inboxConversations = useMemo(
    () =>
      (inboxRaw as Conversation[])
        .map(transformConversation)
        .filter((c): c is ConversationItem => c !== null),
    [inboxRaw, transformConversation],
  );

  const spamConversations = useMemo(
    () =>
      (spamRaw as Conversation[])
        .map(transformConversation)
        .filter((c): c is ConversationItem => c !== null),
    [spamRaw, transformConversation],
  );

  const isLoading = inboxLoading && inboxConversations.length === 0;

  // Track user-initiated pull-to-refresh so background refetches don't show spinner
  const isManualRefresh = useRef(false);
  if (!inboxRefetching) isManualRefresh.current = false;

  const handleRefresh = useCallback(() => {
    isManualRefresh.current = true;
    // refetchQueries triggers an immediate fetch and resolves when done —
    // the RefreshControl spinner dismisses as soon as data arrives.
    // invalidateQueries only marks stale and re-fetches lazily on next render.
    queryClient.refetchQueries({
      queryKey: [...messageKeys.all(currentUser?.id), "filtered"],
    });
  }, [queryClient, currentUser?.id]);

  const handleChatPress = useCallback(
    (id: string, item?: ConversationItem) => {
      navigateToChat(router, {
        conversationId: id,
        peerAvatar: item?.user?.avatar,
        peerUsername: item?.user?.username,
        peerName: item?.user?.name,
      });
    },
    [router],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      router.push(`/(protected)/profile/${username}`);
    },
    [router, queryClient],
  );

  const showToast = useUIStore((s) => s.showToast);

  const handleMarkAsRead = useCallback(
    async (conversationId: string) => {
      try {
        const result = await messagesApiClient.markAsRead(conversationId);
        if (!result.ok) return;
        await refreshMessageCounts(conversationId, result.unread);
        // No toast — mark-as-read fires silently when a conversation opens.
        // A toast on every read would be spammy.
      } catch (err) {
        console.error("[Messages] markAsRead error:", err);
      }
    },
    [refreshMessageCounts, showToast],
  );

  const handleTabPress = useCallback((index: number) => {
    setActiveTab(index);
    pagerRef.current?.setPage(index);
  }, []);

  const handleDeleteConversation = useCallback(
    async (item: ConversationItem) => {
      if (!currentUser?.id || deletingConversationId === item.id) return;

      setDeletingConversationId(item.id);
      try {
        const result = await messagesApiClient.deleteConversation(item.id);
        if (!result.ok) {
          showToast(
            "error",
            "Delete failed",
            "Couldn't remove that conversation",
          );
          return;
        }

        queryClient.setQueryData<any[]>(
          messageKeys.conversations(currentUser.id),
          (old) =>
            Array.isArray(old)
              ? old.filter(
                  (conversation) => String(conversation?.id) !== item.id,
                )
              : old,
        );

        queryClient.setQueriesData<any[]>(
          { queryKey: [...messageKeys.all(currentUser.id), "filtered"] },
          (old) =>
            Array.isArray(old)
              ? old.filter(
                  (conversation) => String(conversation?.id) !== item.id,
                )
              : old,
        );

        if (result.unread) {
          setMessagesUnread(result.unread.inbox);
          setSpamUnread(result.unread.spam);
          queryClient.setQueryData(messageKeys.unreadCount(currentUser.id), {
            inbox: result.unread.inbox,
            spam: result.unread.spam,
          });
        }

        await Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: messageKeys.conversations(currentUser.id),
            refetchType: "active",
          }),
          queryClient.invalidateQueries({
            queryKey: [...messageKeys.all(currentUser.id), "filtered"],
            refetchType: "active",
          }),
          queryClient.invalidateQueries({
            queryKey: messageKeys.unreadCount(currentUser.id),
            refetchType: "active",
          }),
        ]);

        showToast(
          "success",
          item.isGroup ? "Left group" : "Deleted",
          item.isGroup ? "Removed from your messages" : "Conversation removed",
        );
      } catch (error) {
        console.error("[Messages] deleteConversation error:", error);
        showToast(
          "error",
          "Delete failed",
          "Couldn't remove that conversation",
        );
      } finally {
        setDeletingConversationId((current) =>
          current === item.id ? null : current,
        );
      }
    },
    [
      currentUser?.id,
      deletingConversationId,
      queryClient,
      setMessagesUnread,
      setSpamUnread,
      showToast,
    ],
  );

  const handlePageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setActiveTab(e.nativeEvent.position);
    },
    [],
  );

  useEffect(() => {
    setActiveTab(initialTab);
    pagerRef.current?.setPageWithoutAnimation(initialTab);
  }, [initialTab]);

  if (isLoading) {
    return (
      <View
        style={{
          width: windowWidth,
          height: windowHeight,
          backgroundColor: "#000",
          paddingTop: insets.top,
        }}
      >
        <MessagesSkeleton />
      </View>
    );
  }

  return (
    <View
      style={{
        width: windowWidth,
        height: windowHeight,
        backgroundColor: "#000",
        paddingTop: insets.top,
        alignSelf: "center",
      }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <Text className="text-lg font-bold text-foreground">Messages</Text>
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={() =>
              router.push("/(protected)/messages/new-group" as any)
            }
            hitSlop={12}
          >
            <Users size={24} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => router.push("/(protected)/messages/new" as any)}
            hitSlop={12}
          >
            <Edit size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Tab Bar - 3 tabs */}
      <View className="flex-row border-b border-border">
        {/* Inbox Tab */}
        <Pressable
          onPress={() => handleTabPress(0)}
          className={`flex-1 flex-row items-center justify-center gap-1.5 py-3 ${
            activeTab === 0 ? "border-b-2 border-primary" : ""
          }`}
        >
          <Inbox size={16} color={activeTab === 0 ? "#3EA4E5" : "#6B7280"} />
          <Text
            className={`font-semibold text-sm ${
              activeTab === 0 ? "text-primary" : "text-muted-foreground"
            }`}
          >
            Inbox
          </Text>
          {inboxUnreadCount > 0 && (
            <View className="bg-primary rounded-full px-1.5 py-0.5 min-w-[18px] items-center">
              <Text className="text-[10px] text-white font-bold">
                {inboxUnreadCount}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Requests Tab */}
        <Pressable
          onPress={() => handleTabPress(1)}
          className={`flex-1 flex-row items-center justify-center gap-1.5 py-3 ${
            activeTab === 1 ? "border-b-2 border-primary" : ""
          }`}
        >
          <ShieldAlert
            size={16}
            color={activeTab === 1 ? "#3EA4E5" : "#6B7280"}
          />
          <Text
            className={`font-semibold text-sm ${
              activeTab === 1 ? "text-primary" : "text-muted-foreground"
            }`}
          >
            Requests
          </Text>
          {spamUnreadCount > 0 && (
            <View className="bg-muted-foreground rounded-full px-1.5 py-0.5 min-w-[18px] items-center">
              <Text className="text-[10px] text-white font-bold">
                {spamUnreadCount}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Lynk Tab */}
        <Pressable
          onPress={() => handleTabPress(2)}
          className={`flex-1 flex-row items-center justify-center gap-1.5 py-3 ${
            activeTab === 2 ? "border-b-2" : ""
          }`}
          style={activeTab === 2 ? { borderBottomColor: "#FC253A" } : undefined}
        >
          <Radio size={16} color={activeTab === 2 ? "#FC253A" : "#6B7280"} />
          <Text
            className={`font-semibold text-sm ${
              activeTab === 2 ? "" : "text-muted-foreground"
            }`}
            style={activeTab === 2 ? { color: "#FC253A" } : undefined}
          >
            {getLynkDisplayName()}
          </Text>
        </Pressable>
      </View>

      {/* Swipeable Tab Content */}
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={initialTab}
        onPageSelected={handlePageSelected}
        scrollEnabled={false}
      >
        <View key="inbox" style={{ flex: 1 }}>
          <ConversationList
            conversations={inboxConversations}
            isRefreshing={isManualRefresh.current && inboxRefetching}
            onRefresh={handleRefresh}
            onChatPress={handleChatPress}
            onProfilePress={handleProfilePress}
            onMarkAsRead={handleMarkAsRead}
            onDeleteConversation={handleDeleteConversation}
            emptyTitle="No Messages"
            emptyDescription="Messages from people you follow will appear here"
            emptyIcon={Inbox}
            router={router}
            currentUser={currentUser}
            deletingConversationId={deletingConversationId}
          />
        </View>
        <View key="requests" style={{ flex: 1 }}>
          <ConversationList
            conversations={spamConversations}
            isRefreshing={isManualRefresh.current && inboxRefetching}
            onRefresh={handleRefresh}
            onChatPress={handleChatPress}
            onProfilePress={handleProfilePress}
            onMarkAsRead={handleMarkAsRead}
            onDeleteConversation={handleDeleteConversation}
            emptyTitle="No Message Requests"
            emptyDescription="Messages from people you don't follow will appear here"
            emptyIcon={ShieldAlert}
            router={router}
            currentUser={currentUser}
            deletingConversationId={deletingConversationId}
          />
        </View>
        <View key="lynks" style={{ flex: 1 }}>
          <SneakyLynkContent router={router} isActive={activeTab === 2} />
        </View>
      </PagerView>
    </View>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="Messages" onGoBack={() => router.back()}>
      <MessagesScreenContent />
    </ErrorBoundary>
  );
}
