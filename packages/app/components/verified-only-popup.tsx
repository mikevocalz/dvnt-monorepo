import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ShieldAlert } from "lucide-react-native";
import { Dialog } from "@dvnt/ui";
import {
  VERIFIED_ONLY_COPY as COPY,
  canVerify,
  useVerifiedOnlyPromptStore,
} from "@dvnt/app/lib/auth/verified-only-prompt";
import { useVerifiedAdmission } from "@dvnt/app/lib/hooks/use-verified-admission";
import { useVerifiedOnlyRefusalObserver } from "@dvnt/app/lib/hooks/use-verified-only-refusal-observer";
import { useBeginVerification } from "@dvnt/app/lib/hooks/use-begin-verification";

const ACCENT = "#FF5BFC";
const INK = "#0a0408";
const MUTED = "#c9cfdb";
const WARNING = "#fb7185";

/**
 * The verified-only popup. Mounted once at the protected root; opened through
 * `useVerifiedOnlyPromptStore` by `useVerifiedGate` or a server refusal.
 */
export function VerifiedOnlyPopup() {
  useVerifiedOnlyRefusalObserver();
  const open = useVerifiedOnlyPromptStore((s) => s.open);
  const storedReason = useVerifiedOnlyPromptStore((s) => s.reason);
  const close = useVerifiedOnlyPromptStore((s) => s.close);
  const dismiss = useVerifiedOnlyPromptStore((s) => s.dismiss);
  const { data: verdict } = useVerifiedAdmission();
  const { begin, start, opened } = useBeginVerification();

  // The live verdict knows the reason best; a server refusal may not carry one.
  const reason = verdict && verdict.state !== "allowed" ? verdict.reason : storedReason;
  const showVerify = canVerify(reason);

  return (
    <Dialog open={open} onClose={close} hideClose maxWidth={400}>
      <View style={{ gap: 18, paddingTop: 8 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: "rgba(255,91,252,0.14)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ShieldAlert size={22} color={ACCENT} />
        </View>

        <View style={{ gap: 10 }}>
          <Text
            accessibilityRole="header"
            style={{ color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: -0.5 }}
          >
            {COPY.title}
          </Text>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700", lineHeight: 23 }}>
            {COPY.lines[0]}
          </Text>
          <Text style={{ color: MUTED, fontSize: 15, lineHeight: 22 }}>{COPY.lines[1]}</Text>
          <Text style={{ color: MUTED, fontSize: 15, lineHeight: 22 }}>{COPY.lines[2]}</Text>
        </View>

        {start.isError ? (
          <Text selectable style={{ color: WARNING, fontSize: 13 }}>
            {(start.error as Error)?.message || "Couldn't start verification"}. Try again.
          </Text>
        ) : null}

        <View style={{ gap: 8 }}>
          {showVerify ? (
            <Pressable
              onPress={begin}
              disabled={start.isPending}
              accessibilityRole="button"
              accessibilityLabel={opened ? COPY.continueVerifying : COPY.verify}
              accessibilityState={{ disabled: start.isPending, busy: start.isPending }}
              style={{
                minHeight: 48,
                borderRadius: 14,
                borderCurve: "continuous",
                backgroundColor: ACCENT,
                alignItems: "center",
                justifyContent: "center",
                opacity: start.isPending ? 0.6 : 1,
              }}
            >
              {start.isPending ? (
                <ActivityIndicator color={INK} />
              ) : (
                <Text style={{ color: INK, fontSize: 16, fontWeight: "800" }}>
                  {opened ? COPY.continueVerifying : COPY.verify}
                </Text>
              )}
            </Pressable>
          ) : null}
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel={COPY.dismiss}
            style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: MUTED, fontSize: 15, fontWeight: "700" }}>{COPY.dismiss}</Text>
          </Pressable>
        </View>
      </View>
    </Dialog>
  );
}
