import { useState, useEffect } from "react";
import { useIsFocused } from "@react-navigation/native";
import { View, Text } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Button } from "@dvnt/app/components/ui/button";
import { router, useGlobalSearchParams } from "expo-router";
import {
  authClient,
  resendVerificationEmail,
  submitEmailVerification,
} from "@dvnt/app/lib/auth-client";
import { Check, Mail, AlertCircle } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

/**
 * Verify Email Screen
 *
 * Handles two flows:
 * 1. Deep link with token → auto-verifies email
 * 2. Manual landing → shows "check your inbox" message with resend option
 *
 * Deep link format: dvnt://auth/verify-email?token=XXX&callbackURL=YYY
 * Better Auth handles the token exchange via the callbackURL automatically.
 */
export default function VerifyEmailScreen() {
  const [status, setStatus] = useState<
    "checking" | "success" | "error" | "waiting"
  >("checking");
  const { colors } = useColorScheme();
  const showToast = useUIStore((s) => s.showToast);
  const params = useGlobalSearchParams<{ token?: string }>();
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if ((next.user?.authId || next.user?.id) !== (previous.user?.authId || previous.user?.id) ||
          next.isAuthenticated !== previous.isAuthenticated ||
          (next.authStatus === "unauthenticated" && previous.authStatus !== "unauthenticated")) {
        active = false;
        if (timer) clearTimeout(timer);
      }
    });
    const verify = async () => {
      const onVerified = () => {
        if (!active) return;
        setStatus("success");
        showToast("success", "Email Verified", "Your email has been confirmed");
        timer = setTimeout(() => {
          if (active) router.replace("/(protected)/(tabs)" as any);
        }, 2000);
      };
      if (params.token) {
        try {
          const res = await submitEmailVerification(params.token);
          if (!res?.error) { onVerified(); return; }
        } catch (err) {
          console.error("[VerifyEmail] Token verify error:", err);
        }
      }
      if (!active) return;
      // Native callbacks can be session-based and carry no token. Read the
      // server session rather than treating the callback as a generic feed link.
      try {
        const { data: session } = await authClient.getSession();
        if (session?.user?.emailVerified) { onVerified(); return; }
      } catch (err) {
        console.error("[VerifyEmail] Verification check error:", err);
      }
      if (active) setStatus(params.token ? "error" : "waiting");
    };

    void verify();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [params.token, isFocused]);

  const handleResendEmail = async () => {
    try {
      console.log("[VerifyEmail] Resending verification email...");
      const { data: session } = await authClient.getSession();
      if (!session?.user?.email) {
        showToast("error", "Error", "No active session found");
        return;
      }

      const response = await resendVerificationEmail(session.user.email);
      if (response?.error) {
        throw new Error(response.error.message || "Failed to resend verification email");
      }

      showToast(
        "success",
        "Email Sent",
        "Check your inbox for the verification link",
      );
    } catch (err: any) {
      console.error("[VerifyEmail] Resend error:", err);
      showToast(
        "error",
        "Error",
        err?.message || "Failed to resend verification email",
      );
    }
  };

  if (status === "checking") {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground">Verifying your email...</Text>
      </View>
    );
  }

  if (status === "success") {
    return (
      <View className="flex-1 bg-background">
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <View className="items-center gap-6">
            <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center">
              <Check size={40} color={colors.primary} />
            </View>

            <View className="items-center gap-2">
              <Text className="text-2xl font-bold text-foreground text-center">
                Email Verified!
              </Text>
              <Text className="text-muted-foreground text-center">
                Your email has been confirmed. Redirecting...
              </Text>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View className="flex-1 bg-background">
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <View className="items-center gap-6">
            <View className="w-20 h-20 rounded-full bg-destructive/10 items-center justify-center">
              <AlertCircle size={40} color={colors.destructive} />
            </View>

            <View className="items-center gap-2">
              <Text className="text-2xl font-bold text-foreground text-center">
                Verification Failed
              </Text>
              <Text className="text-muted-foreground text-center">
                This verification link is invalid or expired. Please request a
                new one.
              </Text>
            </View>

            <View className="w-full gap-3 mt-4">
              <Button onPress={handleResendEmail}>
                Resend Verification Email
              </Button>
              <Button
                variant="secondary"
                onPress={() => router.replace("/(auth)/login")}
              >
                Back to Login
              </Button>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  // status === "waiting" — user needs to check their inbox
  return (
    <View className="flex-1 bg-background">
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View className="items-center gap-6">
          <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center">
            <Mail size={40} color={colors.primary} />
          </View>

          <View className="items-center gap-2">
            <Text className="text-2xl font-bold text-foreground text-center">
              Check Your Email
            </Text>
            <Text className="text-muted-foreground text-center">
              We've sent a verification link to your email address. Tap the link
              to confirm your account.
            </Text>
          </View>

          <View className="w-full gap-3 mt-4">
            <Button onPress={handleResendEmail}>
              Resend Verification Email
            </Button>
            <Button
              variant="secondary"
              onPress={() => router.replace("/(auth)/login")}
            >
              Back to Login
            </Button>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
