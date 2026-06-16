import { useEffect, useState } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { toast } from "sonner-native";
import { useForm } from "@tanstack/react-form";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { FormInput } from "@dvnt/app/components/form";
import { Button } from "@dvnt/app/components/ui/button";
import { router, useGlobalSearchParams } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LifeBuoy,
  ShieldCheck,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { getSession, submitPasswordReset } from "@dvnt/app/lib/auth-client";
import { AppTrace, getErrorMessage } from "@dvnt/app/lib/diagnostics/app-trace";

const SUPPORT_EMAIL = "DeviantEventsDC@gmail.com";

type ResetStatus = "checking" | "ready" | "success" | "invalid";

export default function ResetPasswordScreen() {
  const [status, setStatus] = useState<ResetStatus>("checking");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const params = useGlobalSearchParams<{ token?: string; error?: string }>();
  const { colors } = useColorScheme();

  useEffect(() => {
    const validateResetState = async () => {
      try {
        const session = await getSession();
        if (session) {
          setStatus("ready");
          AppTrace.trace("RECOVERY", "reset_link_ready");
          return;
        }

        setStatus("invalid");
        AppTrace.warn("RECOVERY", "reset_link_invalid");
      } catch (error) {
        console.error("[ResetPassword] Validation error:", error);
        setStatus("invalid");
        AppTrace.error("RECOVERY", "reset_link_validation_failed", {
          error: getErrorMessage(error),
        });
      }
    };

    void validateResetState();
  }, [params.token, params.error]);

  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      const startedAt = Date.now();
      AppTrace.trace("RECOVERY", "reset_submit_started");

      try {
        const response = await submitPasswordReset(value.password);

        if (response?.error) {
          AppTrace.warn("RECOVERY", "reset_submit_failed", {
            elapsedMs: Date.now() - startedAt,
            error:
              response.error.message ||
              "We couldn’t update your password. Please try again.",
          });
          toast.error("Reset failed", {
            description:
              response.error.message ||
              "We couldn’t update your password. Please try again.",
          });
          return;
        }

        setStatus("success");
        AppTrace.trace("RECOVERY", "reset_submit_success", {
          elapsedMs: Date.now() - startedAt,
        });
        toast.success("Password updated", {
          description: "Your new password is set.",
        });

        setTimeout(() => {
          router.replace("/(auth)/login");
        }, 1800);
      } catch (error: any) {
        AppTrace.error("RECOVERY", "reset_submit_failed_exception", {
          elapsedMs: Date.now() - startedAt,
          error: getErrorMessage(error),
        });
        toast.error("Reset failed", {
          description:
            error?.message ||
            "We couldn’t update your password. Please try again.",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const openSupportEmail = async () => {
    const subject = encodeURIComponent("DVNT Password Reset Help");
    const body = encodeURIComponent(
      "I need help completing a DVNT password reset.",
    );
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  if (status === "checking") {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-base text-muted-foreground text-center">
          Validating your recovery link…
        </Text>
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
          <View className="gap-6 items-center">
            <View className="w-20 h-20 rounded-[24px] bg-primary/10 items-center justify-center">
              <Check size={36} color={colors.primary} />
            </View>

            <View className="gap-2 items-center">
              <Text className="text-2xl font-bold text-foreground text-center">
                Password updated
              </Text>
              <Text className="text-muted-foreground text-center leading-6">
                You’re heading back to sign in with your new password now.
              </Text>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  if (status === "invalid") {
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
          <View className="gap-6 items-center">
            <View className="w-20 h-20 rounded-[24px] bg-destructive/10 items-center justify-center">
              <AlertCircle size={36} color={colors.destructive} />
            </View>

            <View className="gap-2 items-center">
              <Text className="text-2xl font-bold text-foreground text-center">
                This link is no longer valid
              </Text>
              <Text className="text-muted-foreground text-center leading-6">
                Recovery links expire and only the newest one works. Request a
                fresh email to continue.
              </Text>
            </View>

            <View className="w-full rounded-3xl border border-white/10 bg-white/5 p-4 gap-3">
              <View className="flex-row items-start gap-3">
                <ShieldCheck size={18} color={colors.primary} />
                <Text className="flex-1 text-sm text-muted-foreground leading-5">
                  We did not reset anything. Your account stays protected until
                  you complete recovery with a valid link.
                </Text>
              </View>
              <View className="flex-row items-start gap-3">
                <LifeBuoy size={18} color={colors.primary} />
                <Text className="flex-1 text-sm text-muted-foreground leading-5">
                  If the reset email still doesn’t work, contact {SUPPORT_EMAIL}
                  for beta support.
                </Text>
              </View>
            </View>

            <View className="w-full gap-3">
              <Button onPress={() => router.replace("/(auth)/forgot-password")}>
                Request a new recovery link
              </Button>
              <Button variant="secondary" onPress={() => router.replace("/(auth)/login")}>
                Back to sign in
              </Button>
              <Pressable onPress={openSupportEmail} className="items-center py-2">
                <Text className="text-sm text-primary font-medium">
                  Need manual help? Contact support
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: 56,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-8">
          <View className="gap-4">
            <Pressable onPress={() => router.replace("/(auth)/login")} className="self-start">
              <ArrowLeft size={24} color={colors.foreground} />
            </Pressable>

            <View className="gap-2">
              <Text className="text-3xl font-bold text-foreground">
                Create a new password
              </Text>
              <Text className="text-muted-foreground leading-6">
                Choose a strong password you haven’t used for DVNT before.
              </Text>
            </View>
          </View>

          <View className="rounded-3xl border border-white/10 bg-white/5 p-4 gap-3">
            <View className="flex-row items-start gap-3">
              <ShieldCheck size={18} color={colors.primary} />
              <Text className="flex-1 text-sm text-muted-foreground leading-5">
                This link already passed DVNT’s recovery check. Saving here will
                replace your old password immediately.
              </Text>
            </View>
          </View>

          <View className="gap-4">
            <FormInput
              form={form}
              name="password"
              label="New Password"
              placeholder="Enter new password"
              secureTextEntry
              validators={{
                onChange: ({ value }: any) => {
                  if (!value) return "Password is required";
                  if (value.length < 8)
                    return "Password must be at least 8 characters";
                  return undefined;
                },
              }}
            />

            <FormInput
              form={form}
              name="confirmPassword"
              label="Confirm Password"
              placeholder="Re-enter new password"
              secureTextEntry
              validators={{
                onChangeListenTo: ["password"],
                onChange: ({ value, fieldApi }: any) => {
                  const password = fieldApi.form.getFieldValue("password");
                  if (!value) return "Please confirm your password";
                  if (value !== password) return "Passwords do not match";
                  return undefined;
                },
              }}
            />

            <Button
              onPress={form.handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "Saving password..." : "Save new password"}
            </Button>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
