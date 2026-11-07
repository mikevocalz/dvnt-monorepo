import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Radio, WifiOff } from "lucide-react-native";

/** A connection state is actionable, never a screen that traps someone inside. */
export function RoomConnectionNotice({
  status,
  admitted,
  exhausted = false,
  onRetry,
}: {
  status: string;
  admitted: boolean;
  exhausted?: boolean;
  onRetry?: () => Promise<boolean>;
}) {
  const [retrying, setRetrying] = useState(false);
  const inFlight = useRef(false);
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    setTakingLonger(false);
    if (status !== "connecting") return;
    const timer = setTimeout(() => setTakingLonger(true), 12_000);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "connected") return null;
  const waiting = !exhausted && (status === "connecting" || status === "reconnecting" || (admitted && status === "disconnected"));
  const title = exhausted ? "Connection lost" : admitted ? "Reconnecting to your Lynk" : waiting ? "Joining your Lynk" : "Couldn't connect";
  const body = exhausted
    ? "Automatic reconnect attempts have stopped. You can leave below and open this Lynk again."
    : admitted
      ? "Audio and video may be interrupted. Check your connection; we're trying again. Your device controls stay available."
      : takingLonger
        ? "This is taking longer than usual. Check your connection. You can leave at any time."
        : waiting
          ? "Connecting to the room. Your camera and microphone choices will be applied when you join."
          : "Check your connection, then try again. You can also leave below.";

  return (
    <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 12, marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: "rgba(245,197,24,0.22)", backgroundColor: "rgba(245,197,24,0.06)", gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {waiting || retrying ? <ActivityIndicator color="#F5C518" /> : <WifiOff size={19} color="#F5C518" />}
        <Text style={{ flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" }}>{title}</Text>
      </View>
      <Text style={{ color: "#C5C7D1", fontSize: 13, lineHeight: 19 }}>{body}</Text>
      {!exhausted && !admitted && !waiting && onRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry joining this Lynk" accessibilityState={{ disabled: retrying, busy: retrying }} disabled={retrying} onPress={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        setRetrying(true);
        void onRetry().catch(() => false).finally(() => { inFlight.current = false; setRetrying(false); });
      }} style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, opacity: pressed || retrying ? 0.65 : 1 })}>
        <Radio size={17} color="#3FDCFF" />
        <Text style={{ color: "#3FDCFF", fontSize: 13, fontWeight: "700" }}>{retrying ? "Trying again…" : "Try again"}</Text>
      </Pressable> : null}
    </View>
  );
}
