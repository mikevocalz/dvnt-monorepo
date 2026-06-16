/**
 * User Mention Autocomplete Component
 *
 * Provides @ mention functionality for post captions
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { useColorScheme } from "@/lib/hooks";
import { usersApi } from "@/lib/api/users";
import { useQuery } from "@tanstack/react-query";

interface User {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
}

interface UserMentionAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: any;
  multiline?: boolean;
  maxLength?: number;
  onMentionSelect?: (username: string) => void;
}

function extractMentionQuery(
  text: string,
  cursorPosition: number,
): string | null {
  const beforeCursor = text.slice(0, cursorPosition);
  const match = beforeCursor.match(/@(\w*)$/);
  return match ? match[1] : null;
}

export function UserMentionAutocomplete({
  value,
  onChangeText,
  placeholder = "Write a caption...",
  style,
  multiline = true,
  maxLength = 2200,
  onMentionSelect,
}: UserMentionAutocompleteProps) {
  const { colors } = useColorScheme();
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const mentionQuery = useMemo(
    () => extractMentionQuery(value, cursorPosition),
    [value, cursorPosition],
  );

  // Search users when typing @ mention
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["users", "search", mentionQuery],
    queryFn: async () => {
      if (!mentionQuery || mentionQuery.length < 1) return [];
      try {
        const result = await usersApi.searchUsers(
          mentionQuery.toLowerCase(),
          10,
        );
        return (result.docs || []) as unknown as User[];
      } catch (error) {
        console.error("[UserMention] Search error:", error);
        return [];
      }
    },
    enabled: !!mentionQuery && mentionQuery.length >= 1,
  });

  useEffect(() => {
    setShowSuggestions(!!mentionQuery && searchResults.length > 0);
  }, [mentionQuery, searchResults.length]);

  const handleTextChange = useCallback(
    (text: string) => {
      onChangeText(text);
    },
    [onChangeText],
  );

  const handleSelectionChange = useCallback((event: any) => {
    setCursorPosition(event.nativeEvent.selection?.start || 0);
  }, []);

  const insertMention = useCallback(
    (username: string) => {
      const beforeCursor = value.slice(0, cursorPosition);
      const afterCursor = value.slice(cursorPosition);
      const mentionStart = beforeCursor.lastIndexOf("@");
      const newBefore = beforeCursor.slice(0, mentionStart);
      const newText = `${newBefore}@${username} ${afterCursor}`;
      const newCursorPosition = newBefore.length + username.length + 2;

      onChangeText(newText);
      setShowSuggestions(false);
      onMentionSelect?.(username);
    },
    [value, cursorPosition, onChangeText, onMentionSelect],
  );

  const renderSuggestion = useCallback(
    (item: User) => (
      <Pressable
        key={item.id}
        onPress={() => insertMention(item.username)}
        style={[
          styles.suggestionItem,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Image
          source={{
            uri:
              item.avatar ||
              "",
          }}
          style={styles.avatar}
          contentFit="cover"
        />
        <View style={styles.suggestionText}>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {item.username}
          </Text>
          {item.name && (
            <Text style={[styles.name, { color: colors.mutedForeground }]}>
              {item.name}
            </Text>
          )}
        </View>
      </Pressable>
    ),
    [insertMention, colors],
  );

  return (
    <View
      style={[styles.container, showSuggestions && styles.containerElevated]}
    >
      <TextInput
        value={value}
        onChangeText={handleTextChange}
        onSelectionChange={handleSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        maxLength={maxLength}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.card },
          style,
        ]}
        textAlignVertical="top"
        scrollEnabled={false}
        editable={true}
      />

      {showSuggestions && (
        <View
          style={[
            styles.suggestionsContainer,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {isSearching ? (
            <View style={styles.loadingContainer}>
              <Text style={{ color: colors.mutedForeground }}>
                Searching...
              </Text>
            </View>
          ) : searchResults.length > 0 ? (
            <ScrollView
              style={styles.suggestionsList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {searchResults.map(renderSuggestion)}
            </ScrollView>
          ) : (
            <View style={styles.loadingContainer}>
              <Text style={{ color: colors.mutedForeground }}>
                No users found
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  containerElevated: {
    zIndex: 9999,
    elevation: 9999,
  },
  input: {
    fontSize: 16,
    minHeight: 80,
    borderRadius: 12,
    padding: 12,
  },
  suggestionsContainer: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 9999,
    zIndex: 9999,
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  suggestionText: {
    flex: 1,
  },
  username: {
    fontSize: 15,
    fontWeight: "600",
  },
  name: {
    fontSize: 13,
    marginTop: 2,
  },
  loadingContainer: {
    padding: 16,
    alignItems: "center",
  },
});
