import { Text } from "react-native";
import type { CommentAttachment } from "@dvnt/app/lib/types";

/** Native clients retain a readable fallback; the web feature requires no native release. */
export function CommentGif({ attachment }: { attachment: CommentAttachment }) {
  return (
    <Text style={{ color: "#9ca3af", marginTop: 4 }}>
      GIF: {attachment.title}
    </Text>
  );
}
