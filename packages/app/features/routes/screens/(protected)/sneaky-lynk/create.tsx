/**
 * Create Lynk Screen
 * Form to create a new Sneaky Lynk room
 */

import { View, Text, Pressable, TextInput, Switch } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  ArrowLeft,
  Radio,
  Video,
  Globe,
  Lock,
  UserPlus,
  X,
  Plus,
} from "lucide-react-native";
import { useState, useCallback, useEffect, useMemo } from "react";
import * as Haptics from "expo-haptics";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useLynkHistoryStore } from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/src/sneaky-lynk/hooks/useSneakyLynkCaptureProtection";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { usersApi } from "@dvnt/app/lib/api/users";
import { Avatar } from "@dvnt/app/components/ui/avatar";

type Invitee = {
  id: string;
  authId: string;
  username: string;
  avatar: string;
};

function CreateLynkScreenContent() {
  // Protect room config from capture even before joining
  useSneakyLynkCaptureProtection();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const addRoom = useLynkHistoryStore((s) => s.addRoom);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hasVideo, setHasVideo] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResults, setInviteResults] = useState<Invitee[]>([]);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const selfIds = useMemo(
    () =>
      [authUser?.id, (authUser as any)?.authId, (authUser as any)?.auth_id]
        .filter((id): id is string | number => id != null)
        .map((id) => String(id)),
    [authUser],
  );

  useEffect(() => {
    if (isPublic) {
      setInviteSearch("");
      setInviteResults([]);
      return;
    }

    const query = inviteSearch.trim();
    if (query.length < 2) {
      setInviteResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const { docs } = await usersApi.searchUsers(query, 8);
      if (cancelled) return;
      setInviteResults(
        docs
          .map((user: any) => ({
            id: user.id,
            authId: user.authId,
            username: user.username,
            avatar: user.avatar,
          }))
          .filter(
            (user) =>
              user.authId &&
              !selfIds.includes(String(user.authId)) &&
              !selfIds.includes(String(user.id)) &&
              !invitees.some((invitee) => invitee.authId === user.authId),
          ),
      );
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inviteSearch, invitees, isPublic, selfIds]);

  const addInvitee = useCallback(
    (user: Invitee) => {
      if (
        selfIds.includes(String(user.authId)) ||
        selfIds.includes(String(user.id))
      ) {
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInvitees((current) =>
        current.some((invitee) => invitee.authId === user.authId)
          ? current
          : [...current, user],
      );
      setInviteSearch("");
      setInviteResults([]);
    },
    [selfIds],
  );

  const removeInvitee = useCallback((authId: string) => {
    setInvitees((current) =>
      current.filter((invitee) => invitee.authId !== authId),
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      showToast("error", "Error", "Please enter a title for your Lynk");
      return;
    }

    setIsCreating(true);
    try {
      console.log("[CreateLynk] Creating room:", {
        title: title.trim(),
        description: description.trim(),
        hasVideo,
        isPublic,
        invitedUserIds: isPublic
          ? []
          : invitees.map((invitee) => invitee.authId),
      });

      // Create room via Edge Function (persists to DB, visible to all users)
      const result = await sneakyLynkApi.createRoom({
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        hasVideo,
        isPublic,
      });

      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || "Failed to create room");
      }

      const roomId = result.data.room?.id || `space-${Date.now()}`;

      // Record room in local history so it shows on the Lynks tab
      addRoom({
        id: roomId,
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        source: "sneaky_lynk",
        isLive: true,
        hasVideo,
        isPublic,
        status: "open",
        host: {
          id: authUser?.id || "local",
          username: authUser?.username || "You",
          displayName: authUser?.name || authUser?.username || "You",
          avatar: authUser?.avatar || "",
          isVerified: authUser?.isVerified || false,
        },
        speakers: [],
        listeners: 0,
        createdAt: new Date().toISOString(),
      });

      showToast("success", "Lynk Created", "Your Lynk is now live!");

      // Navigate to the new room
      router.replace({
        pathname: "/(protected)/sneaky-lynk/room/[id]",
        params: {
          id: roomId,
          title: title.trim(),
          hasVideo: hasVideo ? "1" : "0",
          isHost: "1",
        },
      } as any);
    } catch (error) {
      console.error("[CreateLynk] Error:", error);
      showToast("error", "Error", "Failed to create Lynk");
    } finally {
      setIsCreating(false);
    }
  }, [
    title,
    description,
    hasVideo,
    isPublic,
    invitees,
    router,
    showToast,
    authUser,
    addRoom,
  ]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <View className="flex-row items-center gap-2">
          <Radio size={20} color="#FC253A" />
          <Text className="text-lg font-bold text-foreground">Create Lynk</Text>
        </View>
        <View className="w-6" />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={40}
      >
        {/* Intro / Pricing Banner */}
        <View
          className="rounded-2xl p-4 mb-6"
          style={{
            backgroundColor: "rgba(252, 37, 58, 0.08)",
            borderWidth: 1,
            borderColor: "rgba(252, 37, 58, 0.2)",
          }}
        >
          <Text className="text-base font-bold text-foreground mb-1">
            {getLynkDisplayName()}
          </Text>
          <Text className="text-sm text-muted-foreground leading-5">
            Host a private video room for your crew. Rooms with fewer than 5
            people under 5 minutes are completely free.
          </Text>
          <View className="flex-row gap-3 mt-3">
            <View
              className="flex-1 rounded-xl p-3"
              style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
            >
              <Text className="text-xs font-bold text-foreground">
                $15 / mo
              </Text>
              <Text className="text-[11px] text-muted-foreground mt-0.5">
                Up to 15 screens
              </Text>
            </View>
            <View
              className="flex-1 rounded-xl p-3"
              style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
            >
              <Text className="text-xs font-bold text-foreground">
                $25 / mo
              </Text>
              <Text className="text-[11px] text-muted-foreground mt-0.5">
                Unlimited screens
              </Text>
            </View>
          </View>
        </View>

        {/* Title Input */}
        <View className="mb-6">
          <Text className="text-sm font-semibold text-muted-foreground mb-2">
            Title *
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What's your Lynk about?"
            placeholderTextColor="#6B7280"
            maxLength={100}
            className="bg-secondary rounded-xl px-4 py-3.5 text-foreground text-base"
          />
          <Text className="text-xs text-muted-foreground mt-1.5 text-right">
            {title.length}/100
          </Text>
        </View>

        {/* Description Input */}
        <View className="mb-6">
          <Text className="text-sm font-semibold text-muted-foreground mb-2">
            Description (optional)
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Tell people what to expect..."
            placeholderTextColor="#6B7280"
            multiline
            numberOfLines={3}
            maxLength={280}
            textAlignVertical="top"
            className="bg-secondary rounded-xl px-4 py-3.5 text-foreground text-base min-h-[100px]"
          />
          <Text className="text-xs text-muted-foreground mt-1.5 text-right">
            {description.length}/280
          </Text>
        </View>

        {/* Video Toggle */}
        <View className="flex-row items-center justify-between bg-secondary rounded-xl px-4 py-4 mb-4">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center">
              <Video size={20} color="#FC253A" />
            </View>
            <View>
              <Text className="text-foreground font-semibold">
                Enable Video
              </Text>
              <Text className="text-xs text-muted-foreground">
                Allow speakers to share video
              </Text>
            </View>
          </View>
          <Switch
            value={hasVideo}
            onValueChange={setHasVideo}
            trackColor={{ false: "#374151", true: "#FC253A" }}
            thumbColor="#fff"
          />
        </View>

        {/* Public/Private Toggle */}
        <View className="flex-row items-center justify-between bg-secondary rounded-xl px-4 py-4 mb-8">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center">
              {isPublic ? (
                <Globe size={20} color="#FC253A" />
              ) : (
                <Lock size={20} color="#FC253A" />
              )}
            </View>
            <View>
              <Text className="text-foreground font-semibold">
                {isPublic ? "Public Lynk" : "Private Lynk"}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {isPublic
                  ? "Anyone can join and listen"
                  : "Only invited users can join"}
              </Text>
            </View>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: "#374151", true: "#FC253A" }}
            thumbColor="#fff"
          />
        </View>

        {!isPublic && (
          <View className="bg-secondary rounded-xl px-4 py-4 mb-8">
            <View className="flex-row items-center gap-2 mb-3">
              <UserPlus size={18} color="#9CA3AF" />
              <Text className="text-sm font-semibold text-foreground">
                Invite People
              </Text>
            </View>

            {invitees.length > 0 && (
              <View className="flex-row flex-wrap gap-2 mb-3">
                {invitees.map((invitee) => (
                  <View
                    key={invitee.authId}
                    className="flex-row items-center gap-2 bg-background px-3 py-1.5 rounded-full"
                  >
                    <Avatar
                      uri={invitee.avatar}
                      username={invitee.username}
                      size={20}
                    />
                    <Text className="text-sm text-foreground">
                      @{invitee.username}
                    </Text>
                    <Pressable
                      onPress={() => removeInvitee(invitee.authId)}
                      hitSlop={8}
                    >
                      <X size={12} color="#9CA3AF" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <TextInput
              className="py-2.5 text-base text-foreground"
              placeholder="Search by username..."
              placeholderTextColor="#6B7280"
              value={inviteSearch}
              onChangeText={setInviteSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {inviteResults.length > 0 && (
              <View className="mt-2 border-t border-border pt-2">
                {inviteResults.map((user) => (
                  <Pressable
                    key={user.authId}
                    onPress={() => addInvitee(user)}
                    className="flex-row items-center gap-3 py-2.5"
                  >
                    <Avatar
                      uri={user.avatar}
                      username={user.username}
                      size={32}
                    />
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        @{user.username}
                      </Text>
                    </View>
                    <Plus size={16} color="#FC253A" />
                  </Pressable>
                ))}
              </View>
            )}

            <Text className="text-xs text-muted-foreground mt-2">
              Only the host, co-hosts, previous members, and invited users can
              join this private Lynk.
            </Text>
          </View>
        )}

        {/* Create Button */}
        <Pressable
          onPress={handleCreate}
          disabled={isCreating || !title.trim()}
          className={`py-4 rounded-full items-center ${
            isCreating || !title.trim() ? "bg-primary/50" : "bg-primary"
          }`}
        >
          <Text className="text-white font-bold text-base">
            {isCreating ? "Creating..." : "Start Lynk"}
          </Text>
        </Pressable>

        {/* Info Text */}
        <Text className="text-xs text-muted-foreground text-center mt-4">
          Your Lynk will go live immediately after creation.{"\n"}
          You'll be the host and can invite speakers.
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

export default function CreateLynkScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="CreateLynk" onGoBack={() => router.back()}>
      <CreateLynkScreenContent />
    </ErrorBoundary>
  );
}
