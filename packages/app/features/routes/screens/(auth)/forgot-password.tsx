import { useMemo, useState } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { toast } from "sonner-native";
import { useForm } from "@tanstack/react-form";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { FormInput } from "@dvnt/app/components/form";
import { Button } from "@dvnt/app/components/ui/button";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  LifeBuoy,
  Mail,
  ShieldCheck,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { requestPasswordReset } from "@dvnt/app/lib/auth-client";
import { AppTrace, getErrorMessage } from "@dvnt/app/lib/diagnostics/app-trace";

const SUPPORT_EMAIL = "DeviantEventsDC@gmail.com";

export default function ForgotPasswordScreen() {
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const { colors } = useColorScheme();

  const defaultEmail = useMemo(
    () => (typeof emailParam === "string" ? emailParam : ""),
    [emailParam],
  );

  const form = useForm({
    defaultValues: { email: defaultEmail },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      const startedAt = Date.now();
      AppTrace.trace("RECOVERY", "request_started", {
        hasEmail: Boolean(value.email.trim()),
      });

      try {
        const response = await requestPasswordReset(value.email.trim());

        if (response?.error) {
          AppTrace.warn("RECOVERY", "request_failed", {
            elapsedMs: Date.now() - startedAt,
            error:
              response.error.message ||
              "We couldn’t send the recovery email. Please try again.",
          });
          toast.error("Recovery failed", {
            description:
              response.error.message ||
              "We couldn’t send the recovery email. Please try again.",
          });
          return;
        }

        setSubmittedEmail(value.email.trim());
        AppTrace.trace("RECOVERY", "request_sent", {
          elapsedMs: Date.now() - startedAt,
        });
        toast.success("Check your email", {
          description: "We sent a secure password reset link.",
        });
      } catch (error: any) {
        AppTrace.error("RECOVERY", "request_failed_exception", {
          elapsedMs: Date.now() - startedAt,
          error: getErrorMessage(error),
        });
        toast.error("Recovery failed", {
          description:
            error?.message ||
            "We couldn’t send the recovery email. Please try again.",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const openSupportEmail = async () => {
    const subject = encodeURIComponent("DVNT Account Recovery");
    const body = encodeURIComponent(
      "I need help recovering my DVNT account.",
    );
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  if (submittedEmail) {
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
              <Mail size={36} color={colors.primary} />
            </View>

            <View className="gap-2 items-center">
              <Text className="text-2xl font-bold text-foreground text-center">
                Check your email
              </Text>
              <Text className="text-muted-foreground text-center leading-6">
                We sent a secure reset link to {submittedEmail}. Use the newest
                email if you requested recovery more than once.
              </Text>
            </View>

            <View className="w-full rounded-3xl border border-white/10 bg-white/5 p-4 gap-3">
              <View className="flex-row items-start gap-3">
                <ShieldCheck size={18} color={colors.primary} />
                <Text className="flex-1 text-sm text-muted-foreground leading-5">
                  Recovery links expire. If this email does not arrive, check
                  spam or request another one below.
                </Text>
              </View>
              <View className="flex-row items-start gap-3">
                <LifeBuoy size={18} color={colors.primary} />
                <Text className="flex-1 text-sm text-muted-foreground leading-5">
                  If you no longer have email access, contact {SUPPORT_EMAIL}
                  for manual help during beta.
                </Text>
              </View>
            </View>

            <View className="w-full gap-3">
              <Button onPress={() => setSubmittedEmail(null)}>
                Send another link
              </Button>
              <Button variant="secondary" onPress={() => router.replace("/(auth)/login")}>
                Back to sign in
              </Button>
              <Pressable onPress={openSupportEmail} className="items-center py-2">
                <Text className="text-sm text-primary font-medium">
                  Need help recovering your account?
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
            <Pressable onPress={() => router.back()} className="self-start">
              <ArrowLeft size={24} color={colors.foreground} />
            </Pressable>

            <View className="gap-2">
              <Text className="text-3xl font-bold text-foreground">
                Recover your account
              </Text>
              <Text className="text-muted-foreground leading-6">
                Use the email attached to your DVNT account. We’ll send a secure
                reset link so you can create a new password.
              </Text>
            </View>
          </View>

          <View className="rounded-3xl border border-white/10 bg-white/5 p-4 gap-3">
            <View className="flex-row items-start gap-3">
              <ShieldCheck size={18} color={colors.primary} />
              <Text className="flex-1 text-sm text-muted-foreground leading-5">
                For now, DVNT recovery is email-based. Name, DOB, phone, and
                backup-email recovery are part of the coordinated backend phase,
                not this client-only pass.
              </Text>
            </View>
          </View>

          <View className="gap-4">
            <FormInput
              form={form}
              name="email"
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              validators={{
                onChange: ({ value }: any) => {
                  if (!value) return "Email is required";
                  if (!value.includes("@")) return "Please enter a valid email";
                  return undefined;
                },
              }}
            />

            <Button
              onPress={form.handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "Sending link..." : "Send recovery link"}
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
