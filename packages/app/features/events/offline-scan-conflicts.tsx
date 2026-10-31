import { View, Text, ScrollView } from "react-native";
import { useOfflineCheckinStore } from "@dvnt/app/lib/stores/offline-checkin-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { scanVerdictMessage } from "@dvnt/app/lib/tickets/scan-verdict";

/** Read-only evidence: never silently resolve an ambiguous door admission. */
export function OfflineScanConflicts({ eventId }: { eventId: string }) {
  const pending = useOfflineCheckinStore((state) => state.pendingScans);
  const user = useAuthStore((state) => state.user);
  const conflicts = pending.filter((scan) => scan.eventId === eventId && scan.conflict &&
    !!scan.scannedBy && (scan.scannedBy === user?.id || scan.scannedBy === user?.authId));
  if (conflicts.length === 0) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: "#FEF3C7", padding: 12, borderRadius: 12, marginVertical: 8 }}>
      <Text style={{ color: "#78350F", fontWeight: "700" }}>Offline scans need staff review ({conflicts.length})</Text>
      <Text style={{ color: "#78350F" }}>These admissions were not confirmed. Automatic retries are paused; ask the organizer to review before admitting again.</Text>
      <ScrollView style={{ maxHeight: 160 }}>
        {conflicts.map((scan, index) => (
          <View key={`${scan.eventId}:${scan.scannedAt}:${index}`} style={{ marginTop: 10 }}>
            <Text style={{ color: "#78350F", fontWeight: "600" }}>Scan recorded {new Date(scan.scannedAt).toLocaleString()}</Text>
            <Text style={{ color: "#78350F" }}>{scanVerdictMessage(scan.conflict!.reason)}</Text>
            {scan.conflict!.checkedInAt ? <Text style={{ color: "#78350F" }}>Server check-in: {new Date(scan.conflict!.checkedInAt!).toLocaleString()}{scan.conflict!.checkedInByName ? ` · ${scan.conflict!.checkedInByName}` : ""}</Text> : null}
            <Text style={{ color: "#78350F" }}>Last attempt: {new Date(scan.conflict!.lastAttemptAt).toLocaleString()}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
