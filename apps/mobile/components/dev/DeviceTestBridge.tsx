import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { useQueryClient } from "@tanstack/react-query";
import { handleSignOut } from "@/lib/auth-client";
import { clearAuthStorage, clearUserDataFromStorage } from "@/lib/utils/storage";
import { clearPersistedQueryCache } from "@/lib/query-persistence";
import { useAppStore } from "@/lib/stores/app-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCreateStoryStore } from "@/lib/stores/create-story-store";
import { useSignupStore } from "@/lib/stores/signup-store";
import { useStoryFlowStore } from "@/lib/stores/story-flow-store";
import { useVerificationStore } from "@/lib/stores/useVerificationStore";
import { storyKeys } from "@/lib/hooks/use-stories";
import type { Story, StoryOverlay } from "@/lib/types";
import { useEditorStore } from "@/src/stories-editor/stores/editor-store";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
} from "@/src/stories-editor/constants";

type DeviceTestAction =
  | "guest_home"
  | "guest_events"
  | "guest_activity"
  | "guest_profile"
  | "guest_search"
  | "location_picker"
  | "telemetry"
  | "public_profile"
  | "forgot_password"
  | "reset_password_invalid"
  | "signup"
  | "verification"
  | "protected_route"
  | "story_create_demo_image"
  | "story_create_demo_video"
  | "story_editor_demo_image"
  | "story_editor_demo_video"
  | "story_editor_demo_text"
  | "story_editor_demo_text_done"
  | "story_editor_demo_text_color"
  | "story_viewer_demo"
  | "story_viewer_demo_text";

type DeviceTestCommand = {
  action: DeviceTestAction;
  username?: string;
  query?: string;
  pathname?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  userId?: string;
  authId?: string;
  email?: string;
  name?: string;
  avatar?: string;
};

const COMMAND_FILE_PATH = `${FileSystem.documentDirectory}device-test-command.json`;
const DEV_STORY_IMAGE_URL =
  "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1080&q=80";
const DEV_STORY_VIDEO_URL =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
const DEV_STORY_GIF_URL = "https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif";
const DEV_TEXT_STORY_BACKGROUND = "#5b1b7a";
const DEV_TEXT_STORY_CONTENT = "After hours 🪩✨\nMeet me in the mirror room";
const DEV_STORY_USER = {
  id: "61",
  authId: "Ubd4uPLChc6W8lNkYJ11f8Zcc0Y11nII",
  username: "genesisthemovement",
  email: "dev-story@dvnt.test",
  name: "Genesis The Movement",
  avatar:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
};
const DEV_VIEWER_USER = {
  id: "11",
  authId: "pKa8v6movw4tdx0uhVN9v2IPiAEwD7ug",
  username: "mikevocalz",
  email: "dev-viewer@dvnt.test",
  name: "Mike Vocalz",
  avatar:
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80",
};
const DEV_STORY_OVERLAYS: StoryOverlay[] = [
  {
    id: "dev-story-text",
    type: "text",
    content: "Late night, done right",
    x: 0.5,
    y: 0.18,
    scale: 1,
    rotation: -2,
    opacity: 1,
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.38)",
    fontFamily: "SpaceGrotesk-Bold",
    fontSizeRatio: 0.062,
    maxWidthRatio: 0.76,
    textAlign: "center",
  },
  {
    id: "dev-story-emoji",
    type: "emoji",
    emoji: "🪩",
    x: 0.78,
    y: 0.32,
    sizeRatio: 0.13,
    scale: 1,
    rotation: 8,
    opacity: 1,
  },
  {
    id: "dev-story-sticker",
    type: "sticker",
    source: "asset",
    assetId: "dvnt-afterhours",
    x: 0.24,
    y: 0.72,
    sizeRatio: 0.24,
    scale: 1,
    rotation: -6,
    opacity: 1,
  },
  {
    id: "dev-story-gif",
    type: "animated_gif",
    url: DEV_STORY_GIF_URL,
    x: 0.72,
    y: 0.72,
    sizeRatio: 0.2,
    scale: 1,
    rotation: 0,
    opacity: 1,
  },
];

function normalizeCommand(raw: string): DeviceTestCommand | null {
  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === "string") {
      return { action: parsed as DeviceTestAction };
    }

    if (parsed && typeof parsed.action === "string") {
      const normalizedParams =
        parsed.params && typeof parsed.params === "object"
          ? Object.fromEntries(
              Object.entries(parsed.params).flatMap(([key, value]) => {
                if (
                  typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "boolean"
                ) {
                  return [[key, String(value)]];
                }

                return [];
              }),
            )
          : undefined;

      return {
        action: parsed.action as DeviceTestAction,
        username:
          typeof parsed.username === "string" ? parsed.username : undefined,
        query: typeof parsed.query === "string" ? parsed.query : undefined,
        pathname:
          typeof parsed.pathname === "string" ? parsed.pathname : undefined,
        params: normalizedParams,
        userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
        authId: typeof parsed.authId === "string" ? parsed.authId : undefined,
        email: typeof parsed.email === "string" ? parsed.email : undefined,
        name: typeof parsed.name === "string" ? parsed.name : undefined,
        avatar: typeof parsed.avatar === "string" ? parsed.avatar : undefined,
      };
    }
  } catch (error) {
    console.warn("[DeviceTestBridge] Failed to parse command:", error);
  }

  return null;
}

async function clearLocalSessionState() {
  try {
    await handleSignOut("USER_REQUESTED");
  } catch (error) {
    console.warn("[DeviceTestBridge] handleSignOut failed:", error);
  }

  clearAuthStorage();
  clearUserDataFromStorage();
  clearPersistedQueryCache();

  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    authStatus: "unauthenticated",
    hasSeenOnboarding: true,
  });

  useAppStore.getState().setNsfwEnabled(false, "device_test_bridge");
  useAppStore.getState().setPendingNotificationRoute(null);
  useAppStore.getState().setPendingShareIntentRoute(null);
  useSignupStore.getState().resetSignup();
  useVerificationStore.getState().reset();
}

function bootstrapProtectedUser(command: DeviceTestCommand) {
  useAuthStore.setState({
    user: {
      id: command.userId || DEV_STORY_USER.id,
      authId: command.authId || DEV_STORY_USER.authId,
      email: command.email || DEV_STORY_USER.email,
      username: command.username || DEV_STORY_USER.username,
      name: command.name || DEV_STORY_USER.name,
      avatar: command.avatar || DEV_STORY_USER.avatar,
      isVerified: false,
      postsCount: 0,
      followersCount: 0,
      followingCount: 0,
    },
    isAuthenticated: true,
    authStatus: "authenticated",
    hasSeenOnboarding: true,
  });
}

function bootstrapSpecificProtectedUser(user: typeof DEV_STORY_USER) {
  useAuthStore.setState({
    user: {
      id: user.id,
      authId: user.authId,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      isVerified: false,
      postsCount: 0,
      followersCount: 0,
      followingCount: 0,
    },
    isAuthenticated: true,
    authStatus: "authenticated",
    hasSeenOnboarding: true,
  });
}

function seedStoryCreatePreview(kind: "image" | "video") {
  const mediaUri = kind === "video" ? DEV_STORY_VIDEO_URL : DEV_STORY_IMAGE_URL;
  useCreateStoryStore.getState().reset();
  useCreateStoryStore.getState().setMediaAssets([
    {
      id: `dev-story-${kind}`,
      uri: mediaUri,
      type: kind,
      kind,
      storyOverlays: DEV_STORY_OVERLAYS,
      storyAnimatedGifOverlays: DEV_STORY_OVERLAYS.filter(
        (overlay): overlay is Extract<StoryOverlay, { type: "animated_gif" }> =>
          overlay.type === "animated_gif",
      ).map((overlay) => ({
        id: overlay.id,
        url: overlay.url,
        x: overlay.x,
        y: overlay.y,
        sizeRatio: overlay.sizeRatio,
        scale: overlay.scale,
        rotation: overlay.rotation,
      })),
    },
  ] as any);
  useCreateStoryStore.getState().setCurrentIndex(0);
  useStoryFlowStore.getState().forceIdle();
  useStoryFlowStore.getState().transitionTo("HUB");
}

function seedStoryViewerDemo(queryClient: ReturnType<typeof useQueryClient>) {
  const demoStories: Story[] = [
    {
      id: "dev-story-group",
      userId: DEV_STORY_USER.id,
      username: DEV_STORY_USER.username,
      avatar: DEV_STORY_USER.avatar,
      hasStory: true,
      isViewed: false,
      isYou: false,
      items: [
        {
          id: "dev-story-item-image",
          type: "image",
          url: DEV_STORY_IMAGE_URL,
          duration: 5000,
          storyOverlays: DEV_STORY_OVERLAYS,
          animatedGifOverlays: [],
          visibility: "public",
        },
      ],
    },
  ];

  queryClient.setQueryData(storyKeys.list(), demoStories);
}

function seedTextOnlyEditorDemo() {
  const editor = useEditorStore.getState();
  editor.resetEditor();
  editor.setTextOnlyMode(true);
  editor.setCanvasBackground("purple-haze");

  const elementId = editor.addTextElement({
    content: DEV_TEXT_STORY_CONTENT,
    fontFamily: "Inter-Bold",
    fontSize: 132,
    color: "#FFF8FE",
    style: "classic",
    textAlign: "center",
    shadowColor: "rgba(0,0,0,0.42)",
    shadowBlur: 12,
    maxWidth: CANVAS_WIDTH * 0.82,
    transform: {
      translateX: CANVAS_WIDTH / 2,
      translateY: CANVAS_HEIGHT * 0.58,
      scale: 1,
      rotation: 0,
    },
  });

  editor.initTextEdit({
    id: elementId,
    content: DEV_TEXT_STORY_CONTENT,
    fontFamily: "Inter-Bold",
    color: "#FFF8FE",
    style: "classic",
    textAlign: "center",
    fontSize: 132,
    lineHeight: 1.18,
  });
  editor.selectElement(elementId);
  editor.setMode("text");
}

async function executeCommand(
  command: DeviceTestCommand,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  console.log("[DeviceTestBridge] Executing command:", command.action);
  const needsSignedOutBootstrap =
    command.action !== "protected_route" &&
    command.action !== "story_create_demo_image" &&
    command.action !== "story_create_demo_video" &&
    command.action !== "story_editor_demo_image" &&
    command.action !== "story_editor_demo_video" &&
    command.action !== "story_editor_demo_text" &&
    command.action !== "story_editor_demo_text_done" &&
    command.action !== "story_editor_demo_text_color" &&
    command.action !== "story_viewer_demo" &&
    command.action !== "story_viewer_demo_text";

  if (needsSignedOutBootstrap) {
    await clearLocalSessionState();
  }

  const routeAfterPublicBootstrap = (
    route:
      | string
      | {
          pathname: string;
          params?: Record<string, string | undefined>;
        },
  ) => {
    router.replace("/(public)/(tabs)" as any);
    setTimeout(() => {
      router.push(route as any);
    }, 1000);
  };

  switch (command.action) {
    case "guest_home":
      router.replace("/(public)/(tabs)" as any);
      return;
    case "guest_events":
      routeAfterPublicBootstrap("/(public)/(tabs)/events");
      return;
    case "signup":
      router.replace("/(auth)/signup" as any);
      return;
    case "guest_activity":
      routeAfterPublicBootstrap("/(public)/(tabs)/activity");
      return;
    case "guest_profile":
      routeAfterPublicBootstrap("/(public)/(tabs)/profile");
      return;
    case "guest_search":
      routeAfterPublicBootstrap({
        pathname: "/(public)/search",
        params:
          typeof command.query === "string" && command.query.length > 0
            ? { query: command.query }
            : undefined,
      });
      return;
    case "location_picker":
      routeAfterPublicBootstrap({
        pathname: "/(public)/dev/location-picker",
        params:
          typeof command.query === "string" && command.query.length > 0
            ? { query: command.query }
            : undefined,
      });
      return;
    case "telemetry":
      routeAfterPublicBootstrap("/(public)/dev/telemetry");
      return;
    case "public_profile":
      if (typeof command.username === "string" && command.username.length > 0) {
        routeAfterPublicBootstrap({
          pathname: "/(public)/profile/[username]",
          params: { username: command.username },
        });
      }
      return;
    case "forgot_password":
      router.replace({
        pathname: "/(auth)/forgot-password",
        params:
          typeof command.query === "string" && command.query.length > 0
            ? { email: command.query }
            : undefined,
      } as any);
      return;
    case "reset_password_invalid":
      router.replace("/(auth)/reset-password" as any);
      return;
    case "verification":
      useSignupStore.setState({
        activeStep: 2,
        termsAccepted: true,
        hasScrolledToBottom: true,
      });
      router.replace({
        pathname: "/(auth)/signup",
        params: { verificationTab: "selfie" },
      } as any);
      return;
    case "protected_route":
      bootstrapProtectedUser(command);
      if (typeof command.pathname === "string" && command.pathname.length > 0) {
        router.replace({
          pathname: command.pathname as any,
          params: command.params,
        } as any);
      }
      return;
    case "story_create_demo_image":
      bootstrapProtectedUser(command);
      seedStoryCreatePreview("image");
      router.replace("/(protected)/story/create" as any);
      return;
    case "story_create_demo_video":
      bootstrapProtectedUser(command);
      seedStoryCreatePreview("video");
      router.replace("/(protected)/story/create" as any);
      return;
    case "story_editor_demo_image":
      bootstrapProtectedUser(command);
      useStoryFlowStore.getState().forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
      router.replace({
        pathname: "/(protected)/story/editor",
        params: {
          uri: encodeURIComponent(DEV_STORY_IMAGE_URL),
          type: "image",
        },
      } as any);
      return;
    case "story_editor_demo_video":
      bootstrapProtectedUser(command);
      useStoryFlowStore.getState().forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
      router.replace({
        pathname: "/(protected)/story/editor",
        params: {
          uri: encodeURIComponent(DEV_STORY_VIDEO_URL),
          type: "video",
        },
      } as any);
      return;
    case "story_editor_demo_text":
      bootstrapProtectedUser(command);
      useStoryFlowStore.getState().forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
      router.replace({
        pathname: "/(protected)/story/editor",
        params: {
          initialMode: "text",
          demoTextSeed: "1",
        },
      } as any);
      return;
    case "story_editor_demo_text_done":
      bootstrapProtectedUser(command);
      useStoryFlowStore.getState().forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
      router.replace("/(protected)/story/create" as any);
      setTimeout(() => {
        router.push({
          pathname: "/(protected)/story/editor",
          params: {
            initialMode: "text",
            demoTextSeed: "1",
            autoDoneTextOnly: "1",
          },
        } as any);
      }, 450);
      return;
    case "story_editor_demo_text_color":
      bootstrapProtectedUser(command);
      useStoryFlowStore.getState().forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
      router.replace({
        pathname: "/(protected)/story/editor",
        params: {
          initialMode: "text",
          demoTextSeed: "1",
          demoTextOpenColor: "1",
        },
      } as any);
      return;
    case "story_viewer_demo":
      bootstrapSpecificProtectedUser(DEV_VIEWER_USER);
      seedStoryViewerDemo(queryClient);
      router.replace({
        pathname: "/(protected)/story/[id]",
        params: {
          id: "dev-story-group",
          username: DEV_STORY_USER.username,
        },
      } as any);
      return;
    case "story_viewer_demo_text":
      bootstrapSpecificProtectedUser(DEV_VIEWER_USER);
      router.replace({
        pathname: "/(protected)/story/[id]",
        params: {
          id: "dev-story-group-text",
          username: DEV_STORY_USER.username,
          demoText: DEV_TEXT_STORY_CONTENT,
          demoBackground: DEV_TEXT_STORY_BACKGROUND,
          demoTextColor: "#FFF8FE",
        },
      } as any);
      return;
    default:
      return;
  }
}

export function DeviceTestBridge() {
  const authStatus = useAuthStore((s) => s.authStatus);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isProcessingRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!__DEV__) return;
    if (!hasHydrated || authStatus === "loading") return;

    console.log("[DeviceTestBridge] Watching command file:", COMMAND_FILE_PATH);

    const processCommand = async () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      try {
        const info = await FileSystem.getInfoAsync(COMMAND_FILE_PATH);
        if (!info.exists) return;

        const raw = await FileSystem.readAsStringAsync(COMMAND_FILE_PATH);
        await FileSystem.deleteAsync(COMMAND_FILE_PATH, { idempotent: true });

        const command = normalizeCommand(raw);
        if (!command) {
          console.warn("[DeviceTestBridge] Ignoring invalid command payload");
          return;
        }

        await executeCommand(command, queryClient);
      } catch (error) {
        console.warn("[DeviceTestBridge] Command execution failed:", error);
      } finally {
        isProcessingRef.current = false;
      }
    };

    void processCommand();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void processCommand();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [authStatus, hasHydrated, queryClient]);

  return null;
}
