import { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Heart } from "lucide-react-native";
import { UserAvatar } from "@/components/ui/avatar";
import { useCommentLikeState } from "@/lib/hooks/use-comment-like-state";
import { MENTION_COLOR } from "@/src/constants/mentions";

function renderCommentText(
  text: string,
  style: any,
  onProfilePress: (username: string) => void,
) {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (!part.startsWith("@")) {
          return <Text key={index}>{part}</Text>;
        }

        const username = part.slice(1);
        return (
          <Text
            key={index}
            onPress={() => onProfilePress(username)}
            style={{ color: MENTION_COLOR, fontWeight: "800" }}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

export interface CommentData {
  id: string;
  username: string;
  avatar?: string;
  text: string;
  timeAgo?: string;
  createdAt?: string;
  likes?: number;
  hasLiked?: boolean;
  postId?: string;
  parentId?: string | null;
  rootId?: string | null;
  depth?: number;
  replies?: CommentData[];
}

interface CommentLikeButtonProps {
  postId: string;
  commentId: string;
  initialLikes?: number;
  initialHasLiked?: boolean;
}

export function CommentLikeButton({
  postId,
  commentId,
  initialLikes = 0,
  initialHasLiked = false,
}: CommentLikeButtonProps) {
  const { hasLiked, likesCount, toggle, isPending } = useCommentLikeState(
    postId,
    commentId,
    initialLikes,
    initialHasLiked,
  );

  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        toggle();
      }}
      disabled={isPending}
      hitSlop={12}
      style={styles.likeButton}
    >
      <Heart
        size={15}
        color={hasLiked ? "#FF5BFC" : "#7C8798"}
        fill={hasLiked ? "#FF5BFC" : "none"}
      />
      {likesCount > 0 ? (
        <Text style={[styles.likeCount, hasLiked && styles.likeCountActive]}>
          {likesCount}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface CommentRowProps {
  comment: CommentData;
  postId: string;
  variant?: "root" | "reply";
  isHighlighted?: boolean;
  onReply?: (username: string, commentId: string) => void;
  onProfilePress: (username: string) => void;
  onViewAllReplies?: (commentId: string) => void;
  replyCount?: number;
}

export function CommentRow({
  comment,
  postId,
  variant = "root",
  isHighlighted = false,
  onReply,
  onProfilePress,
  onViewAllReplies,
  replyCount,
}: CommentRowProps) {
  const avatarSize = variant === "reply" ? 30 : 36;
  const canViewReplies =
    variant === "root" && !!onViewAllReplies && (replyCount || 0) > 0;

  const handleReply = useCallback(() => {
    onReply?.(comment.username, comment.id);
  }, [comment.id, comment.username, onReply]);

  return (
    <View
      style={[
        styles.card,
        variant === "reply" ? styles.replyCard : styles.rootCard,
        isHighlighted && styles.highlightedCard,
      ]}
    >
      <View style={styles.row}>
        <Pressable onPress={() => onProfilePress(comment.username)}>
          <UserAvatar
            uri={comment.avatar}
            username={comment.username}
            size={avatarSize}
            variant="roundedSquare"
          />
        </Pressable>

        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => onProfilePress(comment.username)}>
              <Text
                style={[
                  styles.username,
                  variant === "reply" && styles.replyUsername,
                ]}
              >
                {comment.username}
              </Text>
            </Pressable>
            <Text style={styles.timeAgo}>{comment.timeAgo || ""}</Text>
          </View>

          {renderCommentText(
            comment.text,
            [styles.body, variant === "reply" && styles.replyBody],
            onProfilePress,
          )}

          <View style={styles.actions}>
            <CommentLikeButton
              postId={postId}
              commentId={comment.id}
              initialLikes={comment.likes}
              initialHasLiked={comment.hasLiked}
            />
            {onReply ? (
              <Pressable onPress={handleReply}>
                <Text style={styles.replyText}>Reply</Text>
              </Pressable>
            ) : null}
          </View>

          {canViewReplies ? (
            <Pressable
              onPress={() => onViewAllReplies?.(comment.id)}
              style={styles.viewRepliesButton}
            >
              <Text style={styles.viewRepliesText}>
                View replies ({replyCount})
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

interface ThreadedCommentProps {
  comment: CommentData;
  postId: string;
  isHighlighted?: boolean;
  onReply: (username: string, commentId: string) => void;
  onViewAllReplies?: (commentId: string) => void;
  onProfilePress: (username: string) => void;
  maxVisibleReplies?: number;
  showAllReplies?: boolean;
}

function ThreadedCommentComponent({
  comment,
  postId,
  isHighlighted = false,
  onReply,
  onViewAllReplies,
  onProfilePress,
  maxVisibleReplies = 0,
  showAllReplies = false,
}: ThreadedCommentProps) {
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const visibleReplies =
    showAllReplies || maxVisibleReplies >= replies.length
      ? replies
      : replies.slice(0, maxVisibleReplies);
  const hiddenReplies = Math.max(replies.length - visibleReplies.length, 0);

  return (
    <View style={styles.thread}>
      <CommentRow
        comment={comment}
        postId={postId}
        isHighlighted={isHighlighted}
        onReply={onReply}
        onProfilePress={onProfilePress}
        onViewAllReplies={hiddenReplies > 0 || maxVisibleReplies === 0 ? onViewAllReplies : undefined}
        replyCount={replies.length}
      />

      {visibleReplies.length > 0 ? (
        <View style={styles.replyList}>
          {visibleReplies.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={{ ...reply, replies: [] }}
              postId={postId}
              variant="reply"
              onReply={onReply}
              onProfilePress={onProfilePress}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const ThreadedComment = memo(ThreadedCommentComponent);

const styles = StyleSheet.create({
  thread: {
    gap: 10,
  },
  card: {
    borderRadius: 18,
    backgroundColor: "rgba(17,17,19,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rootCard: {
    marginBottom: 0,
  },
  replyCard: {
    marginLeft: 18,
    backgroundColor: "rgba(22,22,26,0.9)",
  },
  highlightedCard: {
    borderColor: "rgba(62,164,229,0.75)",
    shadowColor: "#3EA4E5",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  content: {
    flex: 1,
    gap: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  replyUsername: {
    fontSize: 13,
  },
  timeAgo: {
    color: "#7C8798",
    fontSize: 12,
  },
  body: {
    color: "#F3F4F6",
    fontSize: 14,
    lineHeight: 20,
  },
  replyBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  likeCount: {
    color: "#7C8798",
    fontSize: 12,
    fontWeight: "700",
  },
  likeCountActive: {
    color: "#FF5BFC",
  },
  replyText: {
    color: "#3EA4E5",
    fontSize: 12,
    fontWeight: "700",
  },
  viewRepliesButton: {
    marginTop: 2,
    alignSelf: "flex-start",
  },
  viewRepliesText: {
    color: "#9CD6F5",
    fontSize: 12,
    fontWeight: "700",
  },
  replyList: {
    gap: 10,
  },
});
