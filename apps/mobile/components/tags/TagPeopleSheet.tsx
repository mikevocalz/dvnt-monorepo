/**
 * TagPeopleSheet — Bottom sheet for searching and selecting users to tag.
 * Used in create/edit post flows.
 *
 * Uses Zustand for all local state (project standard: no useState).
 * Uses TanStack Debouncer for search input (project standard: no setTimeout).
 */

import React, { useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { X, Search, Check } from "lucide-react-native";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { postTagsApi } from "@/lib/api/post-tags";
import { Avatar } from "@/components/ui/avatar";

// ── Types ───────────────────────────────────────────────────
export interface TagCandidate {
  id: number;
  username: string;
  avatar: string;
}

interface TagPeopleSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected users */
  selectedUsers: TagCandidate[];
  /** Called when selection changes */
  onSelectionChange: (users: TagCandidate[]) => void;
}

// ── Zustand store for sheet-local state ─────────────────────
interface TagPeopleSheetState {
  query: string;
  results: TagCandidate[];
  isSearching: boolean;
  setQuery: (q: string) => void;
  setResults: (r: TagCandidate[]) => void;
  setIsSearching: (v: boolean) => void;
  reset: () => void;
}

const useTagPeopleSheetStore = create<TagPeopleSheetState>((set) => ({
  query: "",
  results: [],
  isSearching: false,
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  reset: () => set({ query: "", results: [], isSearching: false }),
}));

// ── Component ───────────────────────────────────────────────
export const TagPeopleSheet: React.FC<TagPeopleSheetProps> = React.memo(
  ({ visible, onClose, selectedUsers, onSelectionChange }) => {
    const {
      query,
      results,
      isSearching,
      setQuery,
      setResults,
      setIsSearching,
      reset,
    } = useTagPeopleSheetStore();
    const sheetRef = useRef<BottomSheet>(null);
    const snapPoints = useMemo(() => ["82%"], []);

    // TanStack Debouncer for search
    const searchDebouncerRef = useRef(
      new Debouncer(
        async (q: string) => {
          if (!q || q.length < 1) {
            setResults([]);
            return;
          }
          setIsSearching(true);
          try {
            const data = await postTagsApi.searchUsers(q, 15);
            setResults(data);
          } catch {
            setResults([]);
          }
        },
        { wait: 300 },
      ),
    );

    const handleQueryChange = useCallback(
      (text: string) => {
        setQuery(text);
        searchDebouncerRef.current.maybeExecute(text);
      },
      [setQuery],
    );

    // Reset on close
    useEffect(() => {
      if (visible) {
        sheetRef.current?.snapToIndex(0);
        return;
      }

      searchDebouncerRef.current.cancel();
      sheetRef.current?.close();
      reset();
    }, [visible, reset]);

    const handleSheetChange = useCallback(
      (index: number) => {
        if (index === -1 && visible) {
          searchDebouncerRef.current.cancel();
          reset();
          onClose();
        }
      },
      [onClose, reset, visible],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.6}
          pressBehavior="close"
        />
      ),
      [],
    );

    const isSelected = useCallback(
      (userId: number) => selectedUsers.some((u) => u.id === userId),
      [selectedUsers],
    );

    const handleToggleUser = useCallback(
      (user: TagCandidate) => {
        if (isSelected(user.id)) {
          onSelectionChange(selectedUsers.filter((u) => u.id !== user.id));
        } else {
          onSelectionChange([...selectedUsers, user]);
        }
      },
      [selectedUsers, onSelectionChange, isSelected],
    );

    const handleRemoveUser = useCallback(
      (userId: number) => {
        onSelectionChange(selectedUsers.filter((u) => u.id !== userId));
      },
      [selectedUsers, onSelectionChange],
    );

    if (!visible) return null;

    return (
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheet}
        handleIndicatorStyle={styles.handle}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={24} color="#fff" />
            </Pressable>
            <Text style={styles.title}>Tag People</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.searchContainer}>
            <Search size={16} color="#999" style={{ marginRight: 8 }} />
            <BottomSheetTextInput
              value={query}
              onChangeText={handleQueryChange}
              placeholder="Search people..."
              placeholderTextColor="#666"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => handleQueryChange("")} hitSlop={8}>
                <X size={16} color="#999" />
              </Pressable>
            )}
          </View>

          {selectedUsers.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsRow}
              contentContainerStyle={styles.chipsContent}
            >
              {selectedUsers.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => handleRemoveUser(user.id)}
                  style={styles.chip}
                >
                  <Avatar
                    uri={user.avatar}
                    username={user.username}
                    size={24}
                    variant="roundedSquare"
                  />
                  <Text style={styles.chipText}>{user.username}</Text>
                  <X size={12} color="#999" />
                </Pressable>
              ))}
            </ScrollView>
          )}

          <ScrollView
            style={styles.resultsList}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.resultsContent}
          >
            {results.map((user) => {
              const selected = isSelected(user.id);
              return (
                <Pressable
                  key={user.id}
                  onPress={() => handleToggleUser(user)}
                  style={styles.resultRow}
                >
                  <Avatar
                    uri={user.avatar}
                    username={user.username}
                    size={44}
                    variant="roundedSquare"
                  />
                  <Text style={styles.resultUsername}>{user.username}</Text>
                  {selected && (
                    <View style={styles.checkCircle}>
                      <Check size={14} color="#fff" strokeWidth={3} />
                    </View>
                  )}
                </Pressable>
              );
            })}

            {isSearching && <Text style={styles.statusText}>Searching...</Text>}
            {!isSearching && query.length > 0 && results.length === 0 && (
              <Text style={styles.statusText}>No users found</Text>
            )}
            {query.length === 0 && selectedUsers.length === 0 && (
              <Text style={styles.statusText}>
                Search for people to tag in this post
              </Text>
            )}
          </ScrollView>
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

TagPeopleSheet.displayName = "TagPeopleSheet";

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  sheetContent: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handle: {
    backgroundColor: "rgba(255,255,255,0.2)",
    width: 44,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  doneText: {
    color: "#3EA4E5",
    fontSize: 16,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    padding: 0,
  },
  chipsRow: {
    maxHeight: 44,
    marginBottom: 8,
  },
  chipsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingRight: 10,
    paddingLeft: 4,
    paddingVertical: 4,
    gap: 6,
  },
  chipText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  resultsList: {
    flex: 1,
    minHeight: 200,
  },
  resultsContent: {
    paddingBottom: 34,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  resultUsername: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#3EA4E5",
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 24,
  },
});
