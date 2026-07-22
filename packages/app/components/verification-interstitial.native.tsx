import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ShieldCheck, Camera } from "lucide-react-native";
import {
  useStartVerification,
  useRefreshVerificationStatus,
  type AgeVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

const P = "rgb(62, 164, 229)";

/**
 * B3 interstitial — NATIVE. "Quick verify — about a minute." Didit's hosted
 * auto-capture opens in an in-app browser (edge detection, glare rejection,
 * DOB off the document); this modal is the framing + failure recovery.
 * Mirror of verification-interstitial.web; tokens per the B0 audit.
 */
export function VerificationInterstitial({
  visible,
  onClose,
  status,
  ageLabel,
}: {
  visible: boolean;
  onClose: () => void;
  status: AgeVerificationStatus | undefined;
  ageLabel: string;
}) {
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();

  const failed = status === "failed" || status === "expired";
  const inReview =
    status === "submitted" || status === "review" || status === "pending";

  const beginCapture = async () => {
    try {
      const result = await start.mutateAsync({ returnUrl: "dvnt://" });
      if (result.status === "passed") {
        onClose();
        return;
      }
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        await WebBrowser.openBrowserAsync(result.url);
        // Back from the hosted flow — re-pull status so a fast pass unlocks.
        void refresh();
      }
    } catch {
      // start.isError renders the inline error below — no dead end.
    }
  };

  const noteBox = {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 12,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            backgroundColor: "#0b0c14",
            padding: 24,
            gap: 16,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900" }}>
            Quick verify — about a minute
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(62,164,229,0.4)",
                backgroundColor: "rgba(62,164,229,0.16)",
              }}
            >
              <ShieldCheck size={24} color={P} />
            </View>
            <Text style={{ flex: 1, color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 21 }}>
              This event is {ageLabel}. Scan your ID once — your camera does the
              work, and you never see this again.
            </Text>
          </View>

          {inReview ? (
            <View style={noteBox}>
              <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 21 }}>
                Your ID is processing — usually under a minute. Come back and
                tap RSVP again once it's done.
              </Text>
            </View>
          ) : null}

          {failed ? (
            <View style={noteBox}>
              <Text style={{ color: "#fb7185", fontSize: 14, lineHeight: 21 }}>
                That scan didn't go through. Try again with better lighting and
                the whole document in frame.
              </Text>
            </View>
          ) : null}

          {start.isError ? (
            <Text style={{ color: "#fb7185", fontSize: 13 }}>
              {(start.error as Error)?.message || "Couldn't start verification"} — try again.
            </Text>
          ) : null}

          <Pressable
            onPress={beginCapture}
            disabled={start.isPending}
            accessibilityRole="button"
            style={{
              height: 48,
              borderRadius: 12,
              backgroundColor: P,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: start.isPending ? 0.6 : 1,
            }}
          >
            {start.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Camera size={18} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
                  {failed ? "Try the scan again" : "Verify with ID"}
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              if (inReview) {
                void refresh();
                onboardingCheckpoint("verification.status_refreshed");
              } else {
                onboardingCheckpoint("verification.dismissed");
                onClose();
              }
            }}
            accessibilityRole="button"
          >
            <Text
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 14,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {inReview ? "Check again" : "Not now"}
            </Text>
          </Pressable>

          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, lineHeight: 17 }}>
            Private — your ID is checked by our verification partner and never
            shown on your profile.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
