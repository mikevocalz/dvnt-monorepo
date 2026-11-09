/**
 * Create Lynk Screen
 * Form to create a new Sneaky Lynk room
 */

import { View, Text, Pressable, TextInput, Switch, ActivityIndicator } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  Radio,
  Video,
  Globe,
  Lock,
  UserPlus,
  X,
  Plus,
  Smartphone,
} from "lucide-react-native";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import * as Haptics from "expo-haptics";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";
import { useLynkHistoryStore } from "@dvnt/app/features/sneaky-lynk";
import { sneakyLynkApi } from "@dvnt/app/features/sneaky-lynk";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/features/sneaky-lynk";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import { lynkCreateSummary } from "@dvnt/app/lib/subscription/lynk-create-summary";
import { useLynkCreateScope, useLynkInviteSearch, resolveCreatedRoomId, roomInviteeIds } from "@dvnt/app/features/sneaky-lynk";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { DETAIL_HEADER_ROW } from "@dvnt/app/components/layout/screen-shell";
import { DetailBackButton } from "@dvnt/app/components/layout/detail-header";

type Invitee = {
  id: string;
  authId: string;
  username: string;
  avatar: string;
};

function CreateLynkScreenContent() {
  const entitlementState = useEntitlements();
  const membership = lynkCreateSummary(entitlementState);
  const creatingRef = useRef(false);
  const draftRevisionRef = useRef(0);
  // Protect room config from capture even before joining
  useSneakyLynkCaptureProtection();

  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const addRoom = useLynkHistoryStore((s) => s.addRoom);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hasVideo, setHasVideo] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [appOnly, setAppOnly] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const captureOwner = useLynkCreateScope(() => {
    draftRevisionRef.current += 1;
    creatingRef.current = false;
    setTitle("");
    setDescription("");
    setHasVideo(false);
    setIsPublic(true);
    setAppOnly(false);
    setIsCreating(false);
    setCreateError(null);
    setInviteSearch("");
    setInvitees([]);
  });
  const handleBack = useCallback(() => {
    captureOwner.revoke();
    router.back();
  }, [captureOwner, router]);

  useEffect(() => {
    const revoke = () => captureOwner.revoke();
    const focus = () => {
      captureOwner.resume();
      creatingRef.current = false;
      setIsCreating(false);
    };
    const removeBeforeRemove = navigation.addListener("beforeRemove", revoke);
    const removeBlur = navigation.addListener("blur", revoke);
    const removeFocus = navigation.addListener("focus", focus);
    if (!navigation.isFocused()) revoke();
    return () => {
      removeBeforeRemove();
      removeBlur();
      removeFocus();
    };
  }, [captureOwner, navigation]);

  const selfIds = useMemo(
    () =>
      [authUser?.id, (authUser as any)?.authId, (authUser as any)?.auth_id]
        .filter((id): id is string | number => id != null)
        .map((id) => String(id)),
    [authUser],
  );

  const inviteSearchState = useLynkInviteSearch({ query: inviteSearch, enabled: !isPublic && !isCreating, selfIds, invitees });
  const inviteResults = inviteSearchState.results;
  useEffect(() => { if (isPublic) setInviteSearch(""); }, [isPublic]);

  const addInvitee = useCallback(
    (user: Invitee) => {
      if (
        selfIds.includes(String(user.authId)) ||
        selfIds.includes(String(user.id))
      ) {
        return;
      }

      draftRevisionRef.current += 1;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInvitees((current) =>
        current.some((invitee) => invitee.authId === user.authId)
          ? current
          : [...current, user],
      );
      setInviteSearch("");
    },
    [selfIds],
  );

  const removeInvitee = useCallback((authId: string) => {
    draftRevisionRef.current += 1;
    setInvitees((current) =>
      current.filter((invitee) => invitee.authId !== authId),
    );
  }, []);

  // Verified-only: opening a Lynk needs a verified account.
  const guardVerified = useVerifiedGate();

  const handleCreate = useCallback(async (isCurrent: () => boolean) => {
    if (creatingRef.current || !isCurrent()) return;
    if (!title.trim()) {
      showToast("error", "Error", "Please enter a title for your Lynk");
      return;
    }

    creatingRef.current = true;
    setCreateError(null);
    setIsCreating(true);
    let didStartNavigation = false;
    try {
      // Create room via Edge Function (persists to DB, visible to all users)
      const result = await sneakyLynkApi.createRoom({
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        hasVideo,
        isPublic,
        appOnly,
        invitedUserIds: roomInviteeIds(isPublic, invitees),
      }, { isCurrent });

      if (!isCurrent()) return;
      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || "Failed to create room");
      }

      const roomId = resolveCreatedRoomId(result.data.room);
      if (!roomId) {
        throw new Error("Your Lynk may have been created, but could not be opened. Check the Lynks tab before trying again.");
      }

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
      didStartNavigation = true;
    } catch (error) {
      console.error("[CreateLynk] Error:", error);
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : "Couldn’t start your Lynk. Try again.";
        setCreateError(message);
        showToast("error", "Couldn’t start Lynk", message);
      }
    } finally {
      if (!didStartNavigation && isCurrent()) {
        creatingRef.current = false;
        setIsCreating(false);
      }
    }
  }, [
    title,
    description,
    hasVideo,
    isPublic,
    appOnly,
    invitees,
    router,
    showToast,
    authUser,
    addRoom,
  ]);

  const handleStart = () => {
    const isCurrent = captureOwner(authUser);
    if (creatingRef.current || !isCurrent()) return;
    const reviewedRevision = ++draftRevisionRef.current;
    guardVerified("sneaky_lynk", () => {
      if (isCurrent() && draftRevisionRef.current === reviewedRevision) {
        draftRevisionRef.current += 1; // Consume this exact reviewed intent once.
        void handleCreate(isCurrent);
      }
    });
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="w-full py-3 border-b border-border">
        {/* Bar is full-bleed; only its CONTENTS cap to the content column. */}
        <View className="flex-row items-center justify-between px-4" style={DETAIL_HEADER_ROW}>
        <DetailBackButton onPress={handleBack} />
        <View className="flex-row items-center gap-2">
          <Radio size={20} color="#FC253A" />
          <Text className="text-lg font-bold text-foreground">Create Lynk</Text>
        </View>
        <View className="w-6" />
      </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20) + 24, width: "100%", maxWidth: 680, alignSelf: "center" }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={40}
      >
        <View className="mb-6">
          <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#FC253A" }}>Your room, your conversation</Text>
          <Text className="mt-2 text-2xl font-bold text-foreground">Set the tone.</Text>
          <Text className="mt-2 text-sm leading-6 text-muted-foreground">Choose who can join and how you want to connect. Your room goes live when you start.</Text>
        </View>
        {/* Intro / Pricing Banner */}
        <View
          className="rounded-2xl p-4 mb-6"
          style={{
            backgroundColor: "rgba(252, 37, 58, 0.08)",
            borderWidth: 1,
            borderColor: "rgba(252, 37, 58, 0.2)",
          }}
        >
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Current membership</Text>
          <Text className="text-base font-bold text-foreground mb-1">{membership.title}</Text>
          <Text className="text-sm text-muted-foreground leading-5">{membership.description}</Text>
          {entitlementState.isError && <Pressable onPress={entitlementState.refetch} accessibilityRole="button" accessibilityLabel="Retry membership check" className="min-h-11 justify-center mt-2"><Text className="text-sm font-semibold text-foreground underline">Retry membership check</Text></Pressable>}
          <View className="mt-3 gap-1">
            {membership.benefits.map((benefit) => <Text key={benefit} className="text-sm text-foreground">{benefit}</Text>)}
          </View>
        </View>

        {/* Title Input */}
        <View className="mb-6">
          <Text className="text-sm font-semibold text-muted-foreground mb-2">
            Title *
          </Text>
          <TextInput
            accessibilityLabel="Lynk title, required"
            editable={!isCreating}
            value={title}
            onChangeText={(value) => { draftRevisionRef.current += 1; setTitle(value); }}
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
            accessibilityLabel="Description, optional"
            editable={!isCreating}
            value={description}
            onChangeText={(value) => { draftRevisionRef.current += 1; setDescription(value); }}
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
          <View className="min-w-0 flex-1 flex-row items-center gap-3 pr-3">
            <View className="w-10 h-10 rounded-lg bg-primary/20 items-center justify-center">
              <Video size={20} color="#FC253A" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-foreground font-semibold">
                Enable Video
              </Text>
              <Text className="text-xs text-muted-foreground">
                Allow speakers to share video
              </Text>
            </View>
          </View>
          <Switch
            disabled={isCreating}
            accessibilityLabel="Enable video"
            value={hasVideo}
            onValueChange={(value) => { draftRevisionRef.current += 1; setHasVideo(value); }}
            trackColor={{ false: "#374151", true: "#FC253A" }}
            thumbColor="#fff"
          />
        </View>

        {/* Public/Private Toggle */}
        <View className="flex-row items-center justify-between bg-secondary rounded-xl px-4 py-4 mb-4">
          <View className="min-w-0 flex-1 flex-row items-center gap-3 pr-3">
            <View className="w-10 h-10 rounded-lg bg-primary/20 items-center justify-center">
              {isPublic ? (
                <Globe size={20} color="#FC253A" />
              ) : (
                <Lock size={20} color="#FC253A" />
              )}
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-foreground font-semibold">
                Public Lynk
              </Text>
              <Text className="text-xs text-muted-foreground">
                {isPublic
                  ? "Public · Discoverable by the community"
                  : "Private · Invited people and returning members"}
              </Text>
            </View>
          </View>
          <Switch
            disabled={isCreating}
            accessibilityLabel="Public Lynk"
            value={isPublic}
            onValueChange={(value) => { draftRevisionRef.current += 1; setIsPublic(value); }}
            trackColor={{ false: "#374151", true: "#FC253A" }}
            thumbColor="#fff"
          />
        </View>

        {/* App-only toggle — the only ENFORCED tier of capture protection.
            The web room's blackout/watermark/shortcut handling is deterrence;
            an app-only room simply never mints a peer token for a browser. */}
        <View className="bg-secondary rounded-xl px-4 py-4 mb-8">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3 flex-1">
              <View className="w-10 h-10 rounded-lg bg-primary/20 items-center justify-center">
                <Smartphone size={20} color="#FC253A" />
              </View>
              <View className="flex-1">
                <Text className="text-foreground font-semibold">
                  App-only room
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Everyone joins in the DVNT app, including you
                </Text>
              </View>
            </View>
            <Switch
              disabled={isCreating}
              accessibilityLabel="App-only room"
              value={appOnly}
              onValueChange={(value) => { draftRevisionRef.current += 1; setAppOnly(value); }}
              trackColor={{ false: "#374151", true: "#FC253A" }}
              thumbColor="#fff"
            />
          </View>
          {appOnly ? (
            <Text className="text-xs text-muted-foreground leading-5 mt-3">
              Browser access is blocked. The app uses device capture protections where supported,
              but no room can prevent someone recording with another device.
            </Text>
          ) : null}
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
                    className="max-w-full flex-row items-center gap-2 bg-background px-3 py-1.5 rounded-lg"
                  >
                    <Avatar
                      uri={invitee.avatar}
                      username={invitee.username}
                      size={20}
                    />
                    <Text numberOfLines={1} className="shrink text-sm text-foreground">
                      @{invitee.username}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${invitee.username}`}
                      disabled={isCreating}
                      className="w-9 h-9 items-center justify-center"
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
              accessibilityLabel="Search people to invite"
              editable={!isCreating}
              value={inviteSearch}
              onChangeText={setInviteSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View accessibilityLiveRegion="polite">
              <Text className="text-sm text-muted-foreground">
                {inviteSearchState.isSearching ? "Searching people…" : inviteSearchState.isError ? "Couldn’t search people. Your selected invitations are saved." : inviteSearchState.isEmpty ? "No more people found. Try another username." : inviteSearch.trim().length < 2 ? "Type at least 2 characters to find people." : ""}
              </Text>
              {inviteSearchState.isError && <Pressable accessibilityRole="button" onPress={inviteSearchState.retry} className="min-h-11 justify-center"><Text className="text-sm font-semibold text-foreground underline">Try again</Text></Pressable>}
            </View>
            {inviteResults.length > 0 && (
              <View className="mt-2 border-t border-border pt-2">
                {inviteResults.map((user) => (
                  <Pressable
                    key={user.authId}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${user.username}`}
                    disabled={isCreating}
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

        <View className="rounded-xl border border-border px-4 py-3 mb-5">
          <Text className="text-sm font-semibold text-foreground">{hasVideo ? "Audio + video" : "Audio room"} · {isPublic ? "Public" : "Private"}</Text>
          <Text className="mt-1 text-xs leading-5 text-muted-foreground">{appOnly ? "DVNT app required for everyone." : "Join from the app or a supported browser."}{!isPublic ? ` ${invitees.length} ${invitees.length === 1 ? "person" : "people"} selected to invite.` : ""}</Text>
        </View>
        {createError && <View accessibilityRole="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 mb-4"><Text className="text-sm leading-6 text-red-100">{createError}</Text></View>}
        {/* Create Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isCreating || !title.trim(), busy: isCreating }}
          onPress={handleStart}
          disabled={isCreating || !title.trim()}
          className={`py-4 rounded-lg flex-row gap-2 justify-center items-center ${
            isCreating || !title.trim() ? "bg-primary/50" : "bg-primary"
          }`}
        >
          {isCreating && <ActivityIndicator color="#fff" size="small" />}
          <Text className="text-white font-bold text-base">
            {isCreating ? "Starting your Lynk…" : "Start Lynk"}
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
