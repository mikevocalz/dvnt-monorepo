import type { RefObject } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Send, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type MentionSuggestion = {
  username: string;
  avatar?: string;
};

interface CommentComposerFooterProps {
  value: string;
  placeholder: string;
  isSubmitting: boolean;
  replyTargetLabel?: string | null;
  mentionSuggestions?: MentionSuggestion[];
  inputRef?: RefObject<TextInput | null>;
  onChangeText: (text: string) => void;
  onSelectionChange: (cursor: number) => void;
  onInsertMention: (username: string) => void;
  onCancelReply: () => void;
  onSubmit: () => void;
}

export function CommentComposerFooter({
  value,
  placeholder,
  isSubmitting,
  replyTargetLabel,
  mentionSuggestions = [],
  inputRef,
  onChangeText,
  onSelectionChange,
  onInsertMention,
  onCancelReply,
  onSubmit,
}: CommentComposerFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(6,6,7,0.96)",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      {replyTargetLabel ? (
        <View
          style={{
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: "#7C8798", fontSize: 12 }}>
            Replying to @{replyTargetLabel}
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={12}>
            <X size={16} color="#7C8798" />
          </Pressable>
        </View>
      ) : null}

      {mentionSuggestions.length > 0 ? (
        <View
          style={{
            marginBottom: 8,
            overflow: "hidden",
            borderRadius: 14,
            backgroundColor: "rgba(24,24,27,0.95)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.07)",
          }}
        >
          <Text
            style={{
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: 4,
              color: "#7C8798",
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            Mention a user
          </Text>
          {mentionSuggestions.map((user) => (
            <Pressable
              key={user.username}
              onPress={() => onInsertMention(user.username)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Image
                source={{ uri: user.avatar || "" }}
                style={{ width: 28, height: 28, borderRadius: 8 }}
              />
              <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "600" }}>
                {user.username}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={(event) =>
            onSelectionChange(event.nativeEvent.selection.end)
          }
          placeholder={placeholder}
          placeholderTextColor="#7C8798"
          multiline
          returnKeyType="send"
          onSubmitEditing={isSubmitting ? undefined : onSubmit}
          blurOnSubmit={false}
          enablesReturnKeyAutomatically
          editable={!isSubmitting}
          style={{
            flex: 1,
            minHeight: 42,
            maxHeight: 110,
            borderRadius: 22,
            backgroundColor: "rgba(24,24,27,0.95)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.07)",
            paddingHorizontal: 16,
            paddingVertical: 10,
            color: "#FFFFFF",
          }}
        />
        <Pressable
          onPress={onSubmit}
          disabled={!value.trim() || isSubmitting}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              value.trim() && !isSubmitting ? "#3EA4E5" : "rgba(24,24,27,0.95)",
          }}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Send size={18} color={value.trim() ? "#FFFFFF" : "#7C8798"} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
