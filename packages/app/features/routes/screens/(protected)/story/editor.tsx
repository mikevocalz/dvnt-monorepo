import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useLayoutEffect, useEffect, useRef } from "react";
import { EditorScreen } from "@dvnt/app/src/stories-editor";
import { useEditorStore } from "@dvnt/app/src/stories-editor/stores/editor-store";
import type { EditorMode } from "@dvnt/app/src/stories-editor";
import { useStoryFlowStore } from "@dvnt/app/lib/stores/story-flow-store";
import { useStoryEditorResultStore } from "@dvnt/app/lib/stores/story-editor-result-store";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "@dvnt/app/lib/types";

const DEV_TEXT_STORY_CONTENT = "After hours 🪩✨\nMeet me in the mirror room";
const DEV_TEXT_STORY_COLOR = "#FFF8FE";

function seedDevTextEditor(openColorTab: boolean) {
  if (!__DEV__) return;

  const editor = useEditorStore.getState();
  editor.setTextEditElementId(null);
  editor.setTextEditContent(DEV_TEXT_STORY_CONTENT);
  editor.setTextEditFont("Inter-Bold");
  editor.setTextEditColor(DEV_TEXT_STORY_COLOR);
  editor.setTextEditStyle("classic");
  editor.setTextEditAlign("center");
  editor.setTextEditFontSize(132);
  editor.setTextEditLetterSpacing(0);
  editor.setTextEditLineHeight(1.18);
  editor.setTextEditorTab(openColorTab ? "color" : "style");
  editor.setMode("text");
}

function StoryEditorRouteContent() {
  const {
    uri,
    type,
    initialMode,
    index,
    autoDoneTextOnly,
    demoTextSeed,
    demoTextOpenColor,
  } = useLocalSearchParams<{
    uri: string;
    type: string;
    initialMode?: string;
    index?: string;
    autoDoneTextOnly?: string;
    demoTextSeed?: string;
    demoTextOpenColor?: string;
  }>();
  const router = useRouter();

  // [REGRESSION LOCK] Reset editor on mount — guarantees no stale state
  // from a previous session. Must be useLayoutEffect (not useEffect) so it
  // fires BEFORE EditorScreen's useEffect(setMedia), preventing the race
  // condition where child setMedia runs first, then parent resetEditor wipes it.
  const didMount = useRef(false);
  useLayoutEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      useEditorStore.getState().resetEditor();
    }
  }, []);

  // FIX: Use safe header update to prevent loops
  useSafeHeader({ headerShown: false });

  useEffect(() => {
    const targetState =
      initialMode === "text"
        ? "TEXT_ONLY"
        : type === "video"
          ? "EDIT_VIDEO"
          : "EDIT_IMAGE";
    const flow = useStoryFlowStore.getState();

    if (flow.state === targetState) {
      return;
    }

    if (flow.state !== "HUB") {
      flow.forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
    }

    useStoryFlowStore.getState().transitionTo(targetState);
  }, [initialMode, type]);

  useEffect(() => {
    if (!(demoTextSeed === "1" && initialMode === "text")) {
      return;
    }

    const timer = setTimeout(() => {
      seedDevTextEditor(demoTextOpenColor === "1");
    }, 320);

    return () => clearTimeout(timer);
  }, [demoTextOpenColor, demoTextSeed, initialMode]);

  const handleClose = () => {
    // Navigate FIRST, then defer reset so the text-only BackgroundPicker
    // doesn't flash during the back animation. The useLayoutEffect reset
    // on next mount guarantees clean state for the next editor session.
    useStoryFlowStore.getState().transitionTo("HUB");
    router.back();
    setTimeout(() => {
      useEditorStore.getState().resetEditor();
      if (__DEV__) {
        const s = useEditorStore.getState();
        if (
          s.mode !== "idle" ||
          s.elements.length > 0 ||
          s.drawingPaths.length > 0
        ) {
          console.error(
            "[STOP-THE-LINE] Editor state NOT clean after cancel:",
            {
              mode: s.mode,
              elements: s.elements.length,
              paths: s.drawingPaths.length,
            },
          );
        }
      }
    }, 350);
  };

  const handleSave = (result: {
    editedUri: string;
    mediaType: "image" | "video";
    storyOverlays: StoryOverlay[];
    animatedGifOverlays: StoryAnimatedGifOverlay[];
  }) => {
    useStoryEditorResultStore.getState().setResult({
      uri: result.editedUri,
      index: Number.parseInt(index ?? "0", 10) || 0,
      mediaType: result.mediaType,
      storyOverlays: result.storyOverlays,
      animatedGifOverlays: result.animatedGifOverlays,
    });
    useStoryFlowStore.getState().transitionTo("HUB");
    router.back();
    setTimeout(() => useEditorStore.getState().resetEditor(), 300);
  };

  return (
    <EditorScreen
      mediaUri={uri ? decodeURIComponent(uri) : ""}
      mediaType={(type as "image" | "video") || "image"}
      onClose={handleClose}
      onSave={handleSave}
      initialMode={initialMode as EditorMode | undefined}
      autoCompleteTextOnly={autoDoneTextOnly === "1"}
    />
  );
}

export default function StoryEditorRoute() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="StoryEditor" onGoBack={() => router.back()}>
      <StoryEditorRouteContent />
    </ErrorBoundary>
  );
}
