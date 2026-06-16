import { View, Text, Pressable, ScrollView, Dimensions } from "react-native";
import { Button, Checkbox } from "@/components/ui";
import { useSignupStore } from "@/lib/stores/signup-store";
import { FileText } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppTrace } from "@/lib/diagnostics/app-trace";

/**
 * SignUpStep3 - Terms Agreement
 *
 * This is STEP 3 in the signup flow (displayed at activeStep index 1):
 * - Step 1 (index 0): User Info (SignUpStep1)
 * - Step 2 (index 1): Terms (SignUpStep3) ← WE ARE HERE
 * - Step 3 (index 2): Verification (SignUpStep2)
 *
 * User reads and accepts terms before proceeding to verification.
 * Account creation happens AFTER verification in SignUpStep2.
 */
export function SignUpStep3() {
  const { termsAccepted, setActiveStep, setTermsAccepted } = useSignupStore();
  const insets = useSafeAreaInsets();

  // Dynamic terms box height: fill available space minus header (~120),
  // progress indicator (~80), checkbox (~80), buttons (~56), gaps (~72),
  // safe areas, and outer padding. Clamp between 160–300.
  const screenHeight = Dimensions.get("window").height;
  const reservedSpace =
    120 + 80 + 80 + 56 + 72 + insets.top + insets.bottom + 100;
  const termsBoxHeight = Math.max(
    160,
    Math.min(300, screenHeight - reservedSpace),
  );

  const handleContinue = () => {
    console.log("[Terms] handleContinue pressed", { termsAccepted });
    if (!termsAccepted) {
      AppTrace.warn("SIGNUP", "terms_continue_blocked", {
        termsAccepted: false,
      });
      return;
    }
    console.log("[Terms] Advancing to step 2 (Verification)");
    AppTrace.trace("SIGNUP", "terms_accepted_continue", {
      termsAccepted: true,
    });
    setActiveStep(2);
  };

  const handleToggleTerms = () => {
    setTermsAccepted(!termsAccepted);
  };

  return (
    <View className="gap-6">
      <View className="items-center gap-2">
        <View className="h-12 w-12 rounded-full bg-primary/60 items-center justify-center">
          <FileText size={24} className="text-white" />
        </View>
        <Text className="text-xl font-semibold text-foreground">
          DVNT Membership Agreement
        </Text>
        <Text className="text-sm text-zinc-500 text-center">
          Please read and accept our policies to continue
        </Text>
      </View>

      <View
        className="border border-border rounded-lg bg-card"
        style={{ height: termsBoxHeight }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          scrollEventThrottle={16}
          nestedScrollEnabled={true}
          showsVerticalScrollIndicator={true}
          bounces={true}
          overScrollMode="always"
        >
          <View style={{ gap: 16 }}>
            <View>
              <Text className="font-semibold text-foreground mb-2">
                About DVNT
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                DVNT is a protected, members-only platform created for Black and
                Brown LGBTQ+ people. We are a safe, affirming, and culturally
                grounded digital home operated by Deviant LLC and Counter
                Culture Society.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                1. Eligibility (18+ Only)
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                DVNT is strictly for adults 18 years or older. All members must
                complete Photo ID + Selfie Verification to confirm age and human
                identity. DVNT does not allow bots, AI-generated profiles,
                impersonators, or fraudulent accounts.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                2. Identity Verification
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                To protect our community, you must submit a valid
                government-issued ID and a live selfie. Your ID is used only to
                verify age and identity, is never shown publicly, and is not
                used for advertising or profile personalization. Your public
                profile uses your chosen name and photos.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                3. Community Standards
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                DVNT has zero tolerance for racism, anti-Blackness, transphobia,
                homophobia, harassment, bullying, doxxing, or any form of
                discrimination. Members must treat others with kindness, respect
                consent, and show consideration for fellow community members.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                4. Privacy Protection
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                DVNT does NOT sell user data, share data with advertisers, or
                run targeted ads. Verification captures stay outside your public
                profile, are used only for trust and age checks, and are not
                used for behavioral analysis. You control your profile
                visibility.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                5. Member Responsibilities
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                You agree to provide accurate information, maintain account
                security, follow Community Standards, and respect other members.
                Violations may result in content removal, suspension, or
                permanent ban.
              </Text>
            </View>

            <View>
              <Text className="font-semibold text-foreground mb-2">
                6. Terms of Service
              </Text>
              <Text className="text-zinc-400 text-sm leading-relaxed">
                By joining DVNT, you accept our Terms of Service, Privacy
                Policy, Community Standards, and Verification Requirements. DVNT
                is provided "as is" and we reserve the right to suspend or
                terminate accounts for violations.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>

      <Pressable
        onPress={handleToggleTerms}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: termsAccepted }}
        hitSlop={8}
        className="flex-row items-start gap-3 p-4 rounded-lg border border-border bg-card"
      >
        <Checkbox
          checked={termsAccepted}
          onCheckedChange={setTermsAccepted}
          borderColor="#34A2DF"
        />
        <Text className="flex-1 text-sm leading-relaxed text-foreground">
          I confirm I am 18+ years old, and I agree to DVNT's Terms of Service,
          Privacy Policy, Community Standards, and Identity Verification
          Requirements.
        </Text>
      </Pressable>

      <View className="flex-row gap-3">
        <Button
          variant="secondary"
          onPress={() => setActiveStep(0)} // Back to Step 1: User Info
          className="flex-1"
        >
          Back
        </Button>
        <Button
          onPress={handleContinue}
          disabled={!termsAccepted}
          className="flex-1"
        >
          Continue to Verification
        </Button>
      </View>
    </View>
  );
}
