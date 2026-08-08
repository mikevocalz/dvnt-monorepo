/**
 * CaptureDisclosureChip (NATIVE)
 *
 * Persistent room-level disclosure: at least one participant is joined from a
 * browser. Web capture protection is deterrence + attribution only — no
 * browser offers an equivalent to Android FLAG_SECURE or the iOS capture
 * blackout, and macOS ⌘⇧3/4/5 and Win+Shift+S are invisible to the page — so
 * a native participant deciding what to show is entitled to know the room
 * isn't uniformly protected.
 *
 * Driven by `webPeerPresent` in the capture store, which tracks presence on
 * the `sneaky-capture-<roomId>` channel (see `useSneakyLynkCaptureBroadcast`).
 * It follows the room live: the chip appears when a web viewer joins and
 * disappears when the last one leaves.
 *
 * Deliberately quiet and non-dismissible. This is a standing fact about the
 * room, not an alert, so it must not be styled like the capture banner and
 * must not be closable while it's still true. The web mirror of this lives in
 * `room.web.tsx` (`WebViewerDisclosureChip`).
 *
 * The chip never claims blocking on either rail. The only enforced tier is an
 * app-only room, where `video_join_room` refuses a web client a peer token —
 * so a room showing this chip is by definition not app-only.
 */

import { Text, View, StyleSheet } from "react-native";
import { ShieldAlert } from "lucide-react-native";
import { useSneakyLynkCaptureStore } from "@dvnt/app/lib/stores/sneaky-lynk-capture-store";

export function CaptureDisclosureChip() {
  const webPeerPresent = useSneakyLynkCaptureStore((s) => s.webPeerPresent);
  if (!webPeerPresent) return null;

  return (
    <View style={styles.chip} accessibilityRole="text">
      <ShieldAlert size={13} color="#FDE68A" />
      <Text style={styles.label} numberOfLines={2}>
        Web viewers in room — capture protection limited on web
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(252, 211, 77, 0.35)",
    backgroundColor: "rgba(252, 211, 77, 0.12)",
  },
  label: {
    flex: 1,
    color: "#FDE68A",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
    letterSpacing: 0.1,
  },
});
