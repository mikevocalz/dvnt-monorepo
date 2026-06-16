import { useState, useEffect } from "react";
import { View, Text } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Button } from "@dvnt/app/components/ui/button";
import { router, useGlobalSearchParams } from "expo-router";
import { authClient, resendVerificationEmail } from "@dvnt/app/lib/auth-client";
import { Check, Mail, AlertCircle } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

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

  useEffect(() => {
    const verify = async () => {
      // If we have a token param, Better Auth's expo client should have
      // already handled the callback. Check if the session is now verified.
      if (params.token) {
        console.log("[VerifyEmail] Token detected, checking verification...");
        try {
          const { data: session } = await authClient.getSession();
          if (session?.user?.emailVerified) {
            console.log("[VerifyEmail] Email verified successfully");
            setStatus("success");
            showToast(
              "success",
              "Email Verified",
              "Your email has been confirmed",
            );
            setTimeout(() => {
              router.replace("/(protected)/(tabs)" as any);
            }, 2000);
            return;
          }
        } catch (err) {
          console.error("[VerifyEmail] Verification check error:", err);
        }
        setStatus("error");
      } else {
        // No token — user landed here manually, show "check inbox" state
        setStatus("waiting");
      }
    };

    verify();
  }, [params.token]);

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
