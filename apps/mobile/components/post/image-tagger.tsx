/**
 * ImageTagger — Instagram-style user tagging on post images
 *
 * Tap on image → place marker → search users → confirm tag
 * Tags display as floating labels with username
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import { X, UserPlus, Search, RotateCw } from "lucide-react-native";
import { Motion, AnimatePresence } from "@legendapp/motion";
import * as Haptics from "expo-haptics";
import { Debouncer } from "@tanstack/react-pacer";
import { postTagsApi, type PostTag } from "@/lib/api/post-tags";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface TaggedUser {
  id: number;
  username: string;
  avatar: string;
  x: number;
  y: number;
}

interface SearchResult {
  id: number;
  username: string;
  avatar: string;
}

interface ImageTaggerProps {
  postId: string;
  mediaUrl: string;
  mediaIndex: number;
  height: number;
  existingTags?: PostTag[];
  onTagsChanged?: (tags: PostTag[]) => void;
  onRotate?: () => void;
  rotationDegrees?: number;
}

export function ImageTagger({
  postId,
  mediaUrl,
  mediaIndex,
  height,
  existingTags = [],
  onTagsChanged,
  onRotate,
  rotationDegrees,
}: ImageTaggerProps) {
  const [tags, setTags] = useState<TaggedUser[]>(() =>
    existingTags
      .filter((t) => t.mediaIndex === mediaIndex)
      .map((t) => ({
        id: t.taggedUserId,
        username: t.username,
        avatar: t.avatar,
        x: t.xPosition,
        y: t.yPosition,
      })),
  );
  const [showTags, setShowTags] = useState(true);
  const [pendingPosition, setPendingPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchDebouncerRef = useRef(
    new Debouncer(
      async (query: string) => {
        if (!query || query.length < 1) {
          setSearchResults([]);
          return;
        }
        setIsSearching(true);
        try {
          const results = await postTagsApi.searchUsers(query, 8);
          setSearchResults(results);
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      },
      { wait: 300 },
    ),
  );

  // Sync existing tags when they change externally
  useEffect(() => {
    setTags(
      existingTags
        .filter((t) => t.mediaIndex === mediaIndex)
        .map((t) => ({
          id: t.taggedUserId,
          username: t.username,
          avatar: t.avatar,
          x: t.xPosition,
          y: t.yPosition,
        })),
    );
  }, [existingTags, mediaIndex]);

  const handleImageTap = useCallback(
    (event: any) => {
      const { locationX, locationY } = event.nativeEvent;
      const x = locationX / SCREEN_WIDTH;
      const y = locationY / height;

      // Clamp to valid range
      const clampedX = Math.max(0.05, Math.min(0.95, x));
      const clampedY = Math.max(0.05, Math.min(0.95, y));

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPendingPosition({ x: clampedX, y: clampedY });
      setSearchQuery("");
      setSearchResults([]);

      // Focus search input after a short delay
      setTimeout(() => searchInputRef.current?.focus(), 100);
    },
    [height],
  );

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }
    searchDebouncerRef.current.maybeExecute(query);
  }, []);

  const handleSelectUser = useCallback(
    async (user: SearchResult) => {
      if (!pendingPosition) return;

      // Check if user is already tagged on this media
      const alreadyTagged = tags.some((t) => t.id === user.id);
      if (alreadyTagged) {
        // Move existing tag to new position
        setTags((prev) =>
          prev.map((t) =>
            t.id === user.id
              ? { ...t, x: pendingPosition.x, y: pendingPosition.y }
              : t,
          ),
        );
      } else {
        setTags((prev) => [
          ...prev,
          {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            x: pendingPosition.x,
            y: pendingPosition.y,
          },
        ]);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingPosition(null);
      setSearchQuery("");
      setSearchResults([]);
      KeyboardController.dismiss();

      // Save to backend
      const updatedTags = alreadyTagged
        ? tags.map((t) =>
            t.id === user.id
              ? { ...t, x: pendingPosition.x, y: pendingPosition.y }
              : t,
          )
        : [
            ...tags,
            {
              id: user.id,
              username: user.username,
              avatar: user.avatar,
              x: pendingPosition.x,
              y: pendingPosition.y,
            },
          ];

      setIsSaving(true);
      try {
        const savedTags = await postTagsApi.setTagsForMedia(
          postId,
          mediaIndex,
          updatedTags.map((t) => ({ userId: t.id, x: t.x, y: t.y })),
        );
        onTagsChanged?.(savedTags);
      } catch (err) {
        console.error("[ImageTagger] Failed to save tags:", err);
      } finally {
        setIsSaving(false);
      }
    },
    [pendingPosition, tags, postId, mediaIndex, onTagsChanged],
  );

  const handleRemoveTag = useCallback(
    async (userId: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const updatedTags = tags.filter((t) => t.id !== userId);
      setTags(updatedTags);

      try {
        await postTagsApi.removeTag(postId, userId, mediaIndex);
        const savedTags = await postTagsApi.getTagsForPost(postId);
        onTagsChanged?.(savedTags);
      } catch (err) {
        console.error("[ImageTagger] Failed to remove tag:", err);
      }
    },
    [tags, postId, mediaIndex, onTagsChanged],
  );

  const handleCancelPending = useCallback(() => {
    setPendingPosition(null);
    setSearchQuery("");
    setSearchResults([]);
    KeyboardController.dismiss();
  }, []);

  const toggleTagVisibility = useCallback(() => {
    setShowTags((prev) => !prev);
  }, []);

  return (
    <View style={[styles.container, { height }]}>
      {/* Image with tap handler */}
      <Pressable onPress={handleImageTap} style={styles.imageContainer}>
        <Image
          source={{ uri: mediaUrl }}
          style={[
            styles.image,
            rotationDegrees
              ? { transform: [{ rotate: `${rotationDegrees}deg` }] }
              : undefined,
          ]}
          contentFit="cover"
          transition={0}
        />

        {/* Existing tags */}
        {showTags &&
          tags.map((tag) => (
            <View
              key={`tag-${tag.id}`}
              style={[
                styles.tagBubble,
                {
                  left: `${tag.x * 100}%`,
                  top: `${tag.y * 100}%`,
                },
              ]}
              pointerEvents="box-none"
            >
              <Pressable
                onLongPress={() => handleRemoveTag(tag.id)}
                style={styles.tagLabel}
              >
                <Text style={styles.tagText}>{tag.username}</Text>
              </Pressable>
              {/* Arrow pointing up */}
              <View style={styles.tagArrow} />
            </View>
          ))}

        {/* Pending position marker */}
        {pendingPosition && (
          <View
            style={[
              styles.pendingMarker,
              {
                left: `${pendingPosition.x * 100}%`,
                top: `${pendingPosition.y * 100}%`,
              },
            ]}
          >
            <View style={styles.pendingDot} />
            <View style={styles.pendingRing} />
          </View>
        )}
      </Pressable>

      {/* Rotate button — rendered above the image tap area */}
      {onRotate && (
        <Pressable onPress={onRotate} hitSlop={8} style={styles.rotateButton}>
          <RotateCw size={18} color="#fff" />
        </Pressable>
      )}

      {/* Rotation badge */}
      {rotationDegrees ? (
        <View style={styles.rotationBadge}>
          <Text style={styles.rotationBadgeText}>{rotationDegrees}°</Text>
        </View>
      ) : null}

      {/* Tag count badge + toggle */}
      {tags.length > 0 && !pendingPosition && (
        <Pressable onPress={toggleTagVisibility} style={styles.tagCountBadge}>
          <UserPlus size={14} color="#fff" />
          <Text style={styles.tagCountText}>{tags.length}</Text>
        </Pressable>
      )}

      {/* Tap hint */}
      {tags.length === 0 && !pendingPosition && (
        <View style={styles.tapHint} pointerEvents="none">
          <UserPlus size={16} color="rgba(255,255,255,0.6)" />
          <Text style={styles.tapHintText}>Tap to tag people</Text>
        </View>
      )}

      {/* Search panel */}
      {pendingPosition && (
        <View style={styles.searchPanel}>
          <View style={styles.searchHeader}>
            <Text style={styles.searchTitle}>Tag People</Text>
            <Pressable onPress={handleCancelPending} hitSlop={12}>
              <X size={20} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.searchInputContainer}>
            <Search size={16} color="rgba(255,255,255,0.4)" />
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search for a person..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                hitSlop={12}
              >
                <X size={14} color="rgba(255,255,255,0.4)" />
              </Pressable>
            )}
          </View>

          {/* Results */}
          <ScrollView
            style={styles.resultsList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {isSearching ? (
              <Text style={styles.searchStatus}>Searching...</Text>
            ) : searchResults.length > 0 ? (
              searchResults.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => handleSelectUser(user)}
                  style={styles.resultRow}
                >
                  <Image
                    source={{
                      uri: user.avatar || "",
                    }}
                    style={styles.resultAvatar}
                  />
                  <Text style={styles.resultUsername}>{user.username}</Text>
                  {tags.some((t) => t.id === user.id) && (
                    <View style={styles.alreadyTaggedBadge}>
                      <Text style={styles.alreadyTaggedText}>Tagged</Text>
                    </View>
                  )}
                </Pressable>
              ))
            ) : searchQuery.length > 0 ? (
              <Text style={styles.searchStatus}>No users found</Text>
            ) : (
              <Text style={styles.searchStatus}>Type a name to search</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    position: "relative",
  },
  imageContainer: {
    flex: 1,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  tagBubble: {
    position: "absolute",
    transform: [{ translateX: -40 }, { translateY: 8 }],
    alignItems: "center",
  },
  tagLabel: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "#FF5BFC",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 18,
  },
  tagText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  tagArrow: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FF5BFC",
    marginBottom: 4,
  },
  pendingMarker: {
    position: "absolute",
    transform: [{ translateX: -12 }, { translateY: -12 }],
    alignItems: "center",
    justifyContent: "center",
  },
  pendingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
    position: "absolute",
  },
  pendingRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fff",
  },
  tagCountBadge: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagCountText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  tapHint: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tapHintText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "500",
  },
  searchPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: 280,
    paddingBottom: 8,
  },
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  searchTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
  },
  resultsList: {
    maxHeight: 160,
    paddingHorizontal: 16,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  resultAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  resultUsername: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  alreadyTaggedBadge: {
    backgroundColor: "rgba(138,64,207,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  alreadyTaggedText: {
    color: "#8A40CF",
    fontSize: 11,
    fontWeight: "600",
  },
  searchStatus: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
  rotateButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  rotationBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 20,
    backgroundColor: "rgba(138,64,207,0.8)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rotationBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
