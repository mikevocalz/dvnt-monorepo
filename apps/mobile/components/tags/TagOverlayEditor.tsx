/**
 * TagOverlayEditor — Overlay for placing, dragging, and removing tags on images.
 * Used in create/edit post screens.
 *
 * Tap image → place tag at normalized coords.
 * Pan existing tag → reposition (clamped 0..1).
 * Long-press tag → remove.
 *
 * Uses Reanimated for smooth drag. Zustand for state (no useState).
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { create } from "zustand";
import type { TagCandidate } from "./TagPeopleSheet";

// ── Types ───────────────────────────────────────────────────
export interface PlacedTag {
  userId: number;
  username: string;
  avatar: string;
  x: number; // 0–1 normalized
  y: number; // 0–1 normalized
  mediaIndex: number;
}

interface TagOverlayEditorProps {
  /** Image dimensions in layout pixels (from onLayout) */
  imageWidth: number;
  imageHeight: number;
  /** Current media slide index */
  mediaIndex: number;
  /** Currently placed tags */
  tags: PlacedTag[];
  /** Called when tags change */
  onTagsChange: (tags: PlacedTag[]) => void;
  /** Users selected from TagPeopleSheet but not yet placed */
  pendingUsers: TagCandidate[];
  /** Called when a pending user is consumed (placed) */
  onPendingUserPlaced: (userId: number) => void;
}

// ── Zustand store for editor-local state ────────────────────
interface TagEditorState {
  draggingTagId: number | null;
  setDraggingTagId: (id: number | null) => void;
}

const useTagEditorStore = create<TagEditorState>((set) => ({
  draggingTagId: null,
  setDraggingTagId: (draggingTagId) => set({ draggingTagId }),
}));

// ── Draggable Tag ───────────────────────────────────────────
interface DraggableTagProps {
  tag: PlacedTag;
  imageWidth: number;
  imageHeight: number;
  onPositionChange: (userId: number, x: number, y: number) => void;
  onRemove: (userId: number) => void;
}

const DraggableTag: React.FC<DraggableTagProps> = React.memo(
  ({ tag, imageWidth, imageHeight, onPositionChange, onRemove }) => {
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const scale = useSharedValue(1);
    const setDragging = useTagEditorStore((s) => s.setDraggingTagId);

    const panGesture = Gesture.Pan()
      .onStart(() => {
        runOnJS(setDragging)(tag.userId);
        scale.value = withSpring(1.1, { damping: 15 });
      })
      .onChange((e) => {
        translateX.value += e.changeX;
        translateY.value += e.changeY;
      })
      .onEnd(() => {
        scale.value = withSpring(1, { damping: 15 });
        runOnJS(setDragging)(null);

        // Calculate new normalized position
        const newPixelX = tag.x * imageWidth + translateX.value;
        const newPixelY = tag.y * imageHeight + translateY.value;
        const newX = Math.max(0, Math.min(1, newPixelX / imageWidth));
        const newY = Math.max(0, Math.min(1, newPixelY / imageHeight));

        // Reset translation (position is now in the tag's x/y)
        translateX.value = 0;
        translateY.value = 0;

        runOnJS(onPositionChange)(tag.userId, newX, newY);
      });

    const longPressGesture = Gesture.LongPress()
      .minDuration(500)
      .onEnd((_e, success) => {
        if (success) {
          runOnJS(onRemove)(tag.userId);
        }
      });

    const composed = Gesture.Race(panGesture, longPressGesture);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    }));

    return (
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[
            editorStyles.tagContainer,
            {
              left: `${tag.x * 100}%`,
              top: `${tag.y * 100}%`,
            },
            animatedStyle,
          ]}
        >
          {/* Anchor dot */}
          <View style={editorStyles.anchorDot} />
          {/* Bubble */}
          <View style={editorStyles.bubble}>
            <Text style={editorStyles.username} numberOfLines={1}>
              {tag.username}
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>
    );
  },
);

DraggableTag.displayName = "DraggableTag";

// ── Main Editor Overlay ─────────────────────────────────────
export const TagOverlayEditor: React.FC<TagOverlayEditorProps> = React.memo(
  ({
    imageWidth,
    imageHeight,
    mediaIndex,
    tags,
    onTagsChange,
    pendingUsers,
    onPendingUserPlaced,
  }) => {
    const draggingTagId = useTagEditorStore((s) => s.draggingTagId);

    // Filter tags for current media slide
    const currentTags = tags.filter((t) => t.mediaIndex === mediaIndex);

    const handleTapToPlace = useCallback(
      (e: any) => {
        if (draggingTagId !== null) return; // Ignore tap during drag
        if (pendingUsers.length === 0) return; // No users to place

        const { locationX, locationY } = e.nativeEvent;
        if (imageWidth <= 0 || imageHeight <= 0) return;

        const x = Math.max(0, Math.min(1, locationX / imageWidth));
        const y = Math.max(0, Math.min(1, locationY / imageHeight));

        // Place the first pending user
        const user = pendingUsers[0];
        const newTag: PlacedTag = {
          userId: user.id,
          username: user.username,
          avatar: user.avatar,
          x,
          y,
          mediaIndex,
        };

        onTagsChange([...tags, newTag]);
        onPendingUserPlaced(user.id);
      },
      [
        draggingTagId,
        pendingUsers,
        imageWidth,
        imageHeight,
        mediaIndex,
        tags,
        onTagsChange,
        onPendingUserPlaced,
      ],
    );

    const handlePositionChange = useCallback(
      (userId: number, newX: number, newY: number) => {
        onTagsChange(
          tags.map((t) =>
            t.userId === userId && t.mediaIndex === mediaIndex
              ? { ...t, x: newX, y: newY }
              : t,
          ),
        );
      },
      [tags, mediaIndex, onTagsChange],
    );

    const handleRemove = useCallback(
      (userId: number) => {
        Alert.alert("Remove Tag", "Remove this tag?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              onTagsChange(
                tags.filter(
                  (t) => !(t.userId === userId && t.mediaIndex === mediaIndex),
                ),
              );
            },
          },
        ]);
      },
      [tags, mediaIndex, onTagsChange],
    );

    return (
      <Pressable
        onPress={handleTapToPlace}
        style={StyleSheet.absoluteFill}
      >
        {/* Placement hint */}
        {pendingUsers.length > 0 && (
          <View style={editorStyles.hintContainer} pointerEvents="none">
            <Text style={editorStyles.hintText}>
              Tap to place @{pendingUsers[0].username}
            </Text>
          </View>
        )}

        {/* Existing tags (draggable) */}
        {currentTags.map((tag) => (
          <DraggableTag
            key={`edit-tag-${tag.userId}-${tag.mediaIndex}`}
            tag={tag}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onPositionChange={handlePositionChange}
            onRemove={handleRemove}
          />
        ))}
      </Pressable>
    );
  },
);

TagOverlayEditor.displayName = "TagOverlayEditor";

const editorStyles = StyleSheet.create({
  tagContainer: {
    position: "absolute",
    alignItems: "center",
    transform: [{ translateX: -3 }, { translateY: -3 }],
    zIndex: 10,
  },
  anchorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF5BFC",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  bubble: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "#FF5BFC",
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 160,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  hintContainer: {
    position: "absolute",
    top: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  hintText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: "hidden",
  },
});
