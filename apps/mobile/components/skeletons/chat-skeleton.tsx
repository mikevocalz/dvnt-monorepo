import { View, StyleSheet } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

// Simulate a realistic conversation with varied bubble widths
const MESSAGES: { isMe: boolean; width: number; lines: number }[] = [
  { isMe: false, width: 200, lines: 2 },
  { isMe: true, width: 160, lines: 1 },
  { isMe: false, width: 120, lines: 1 },
  { isMe: true, width: 220, lines: 2 },
  { isMe: false, width: 180, lines: 1 },
  { isMe: true, width: 140, lines: 1 },
  { isMe: false, width: 240, lines: 2 },
  { isMe: true, width: 100, lines: 1 },
];

function MessageBubbleSkeleton({
  isMe,
  width,
  lines,
}: {
  isMe: boolean;
  width: number;
  lines: number;
}) {
  return (
    <View style={[styles.messageRow, isMe ? styles.myRow : styles.theirRow]}>
      {!isMe && <SkeletonCircle size={28} />}
      <View
        style={[
          styles.bubble,
          isMe ? styles.myBubble : styles.theirBubble,
          { width },
        ]}
      >
        <SkeletonText width={width - 32} height={14} />
        {lines > 1 && (
          <SkeletonText
            width={width * 0.6}
            height={14}
            style={{ marginTop: 4 }}
          />
        )}
        <SkeletonText width={36} height={10} style={styles.time} />
      </View>
    </View>
  );
}

export function ChatSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header: back | avatar + name/status | phone | video */}
      <View style={styles.header}>
        <Skeleton style={styles.iconBtn} />
        <View style={styles.headerProfile}>
          <SkeletonCircle size={40} />
          <View style={styles.headerInfo}>
            <SkeletonText width={100} height={14} />
            <SkeletonText width={64} height={11} style={{ marginTop: 4 }} />
          </View>
        </View>
        <View style={styles.headerCallBtns}>
          <Skeleton style={styles.callBtn} />
          <Skeleton style={styles.callBtn} />
        </View>
      </View>

      {/* Messages */}
      <View style={styles.messagesList}>
        {MESSAGES.map((msg, i) => (
          <MessageBubbleSkeleton
            key={i}
            isMe={msg.isMe}
            width={msg.width}
            lines={msg.lines}
          />
        ))}
      </View>

      {/* Input bar: camera | gallery | text field | send */}
      <View style={styles.inputBar}>
        <Skeleton style={styles.inputIcon} />
        <Skeleton style={styles.inputIcon} />
        <Skeleton style={styles.textField} />
        <Skeleton style={styles.sendBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  headerProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  headerInfo: {
    flex: 1,
  },
  headerCallBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  messagesList: {
    flex: 1,
    padding: 16,
    gap: 6,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 4,
  },
  myRow: {
    justifyContent: "flex-end",
  },
  theirRow: {
    justifyContent: "flex-start",
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  myBubble: {
    backgroundColor: "rgba(62,164,229,0.15)",
    borderBottomRightRadius: 6,
  },
  theirBubble: {
    backgroundColor: "#1a1a1a",
    borderBottomLeftRadius: 6,
  },
  time: {
    marginTop: 6,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  textField: {
    flex: 1,
    height: 40,
    borderRadius: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});
