import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ShieldCheck } from "lucide-react-native";
import {
  useVerifiedAdmission,
  useAdmissionPromptStore,
} from "@dvnt/app/lib/hooks/use-verified-admission";
import {
  useStartVerification,
  useRefreshVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

const PRIMARY = "rgb(62, 164, 229)";
const WARNING = "#fb7185";

/**
 * Verified-only admission prompt, above the feed next to PostUploadStatus.
 *
 * Grace: dismissible for this launch, back next time, with the deadline in the
 * copy. Blocked: stays, because it is the reason the member's next post,
 * ticket, room or message will be refused. Reading and verifying stay open in
 * both states. Renders nothing while enforcement is off.
 */
export function VerifiedAdmissionBanner() {
  const authId = useAuthStore((s) => s.user?.authId);
  const { data: verdict } = useVerifiedAdmission();
  const dismissed = useAdmissionPromptStore((s) => s.dismissed);
  const dismiss = useAdmissionPromptStore((s) => s.dismiss);
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();
  const [opened, setOpened] = useState(false);

  if (!authId || !verdict || verdict.state === "allowed") return null;
  const blocked = verdict.state === "blocked";
  if (!blocked && dismissed.includes(authId)) return null;
  // An under-18 document has no retry: there is nothing to submit again.
  const canVerify = verdict.reason !== "underage";

  const beginCapture = async () => {
    try {
      const result = await start.mutateAsync({ returnUrl: "dvnt://" });
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        await WebBrowser.openBrowserAsync(result.url);
      }
      void refresh();
    } catch {
      // start.isError renders below — no dead end.
    }
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 12,
        marginVertical: 5,
        padding: 12,
        borderRadius: 12,
        backgroundColor: "#161c29",
        borderWidth: 1,
        borderColor: blocked ? "rgba(251,113,133,0.4)" : "rgba(62,164,229,0.35)",
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <ShieldCheck size={20} color={blocked ? WARNING : PRIMARY} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "white", fontWeight: "700" }}>
            {blocked ? "Verification needed to take part" : "Verify your ID"}
          </Text>
          <Text style={{ color: "#bbc3cf", marginTop: 3, lineHeight: 20 }}>
            {verdict.message}
          </Text>
        </View>
      </View>

      {start.isError ? (
        <Text style={{ color: WARNING, fontSize: 13 }}>
          {(start.error as Error)?.message || "Couldn't start verification"} — try again.
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {canVerify ? (
          <Pressable
            onPress={beginCapture}
            disabled={start.isPending}
            accessibilityRole="button"
            accessibilityLabel="Verify with ID"
            style={{
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 10,
              backgroundColor: PRIMARY,
              alignItems: "center",
              justifyContent: "center",
              opacity: start.isPending ? 0.6 : 1,
            }}
          >
            {start.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {opened ? "Continue verifying" : "Verify with ID"}
              </Text>
            )}
          </Pressable>
        ) : null}
        {blocked ? null : (
          <Pressable
            onPress={() => {
              onboardingCheckpoint("verification.dismissed");
              dismiss(authId);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss until next launch"
            hitSlop={8}
            style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }}
          >
            <Text style={{ color: "#bbc3cf", fontWeight: "700" }}>Not now</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
