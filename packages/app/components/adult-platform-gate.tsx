import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import type { AdmissionVerdict } from "@dvnt/app/lib/auth/verified-admission";
import { useStartVerification } from "@dvnt/app/lib/hooks/use-age-verification";
import { handleSignOut } from "@dvnt/app/lib/auth-client";

export function AdultPlatformGate({ verdict }: { verdict: AdmissionVerdict }) {
  const start = useStartVerification();
  const underage = verdict.reason === "underage";

  const verify = async () => {
    const result = await start.mutateAsync({ returnUrl: "dvnt://auth/verify" });
    if (result.url) await Linking.openURL(result.url);
  };

  return (
    <View
      style={{ flex: 1, backgroundColor: "#000", paddingHorizontal: 24, justifyContent: "center", gap: 18 }}
      accessibilityViewIsModal
    >
      <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800" }}>
        {underage ? "DVNT is 18+" : "Verify your ID to enter DVNT"}
      </Text>
      <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 16, lineHeight: 24 }}>
        {underage
          ? "This account cannot access DVNT because the verified date of birth is under 18."
          : verdict.message ||
            "An account is not activated until adult identity verification is approved."}
      </Text>
      {start.isError ? (
        <Text style={{ color: "#fb7185", fontSize: 14 }}>
          {(start.error as Error)?.message || "Couldn't start verification."}
        </Text>
      ) : null}
      {!underage ? (
        <Pressable
          onPress={verify}
          disabled={start.isPending}
          accessibilityRole="button"
          accessibilityLabel="Verify identity"
          style={{ minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#3EA4E5", opacity: start.isPending ? 0.6 : 1 }}
        >
          {start.isPending ? <ActivityIndicator color="#fff" /> : (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Verify with ID</Text>
          )}
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => void handleSignOut("USER_REQUESTED")}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 15, fontWeight: "600" }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
