import { View, Text } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SignUpStep1, SignUpStep2, SignUpStep3 } from "@dvnt/app/components/signup";
import { useSignupStore } from "@dvnt/app/lib/stores/signup-store";
import { Check } from "lucide-react-native";

const STEPS = ["User Info", "Terms", "Verification"] as const;

function StepIndicator({ activeStep }: { activeStep: number }) {
  return (
    <View className="flex-row items-center justify-center px-6 pt-6 pb-4">
      {STEPS.map((label, i) => {
        const isCompleted = i < activeStep;
        const isActive = i === activeStep;
        return (
          <View key={label} className="flex-1 items-center">
            <View className="flex-row items-center w-full justify-center">
              {i > 0 && (
                <View
                  className="flex-1 h-[2px]"
                  style={{
                    backgroundColor: isCompleted ? "#34A2DF" : "#3f3f46",
                  }}
                />
              )}
              <View
                className="h-8 w-8 rounded-full items-center justify-center border-2"
                style={{
                  borderColor: isCompleted || isActive ? "#34A2DF" : "#71717a",
                  backgroundColor: isCompleted ? "#34A2DF" : "transparent",
                }}
              >
                {isCompleted ? (
                  <Check size={14} color="#fff" />
                ) : (
                  <Text
                    className="text-xs font-bold"
                    style={{
                      color: isActive ? "#34A2DF" : "#71717a",
                    }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              {i < STEPS.length - 1 && (
                <View
                  className="flex-1 h-[2px]"
                  style={{
                    backgroundColor: isCompleted ? "#34A2DF" : "#3f3f46",
                  }}
                />
              )}
            </View>
            <Text
              className="text-xs mt-1"
              style={{
                color: isCompleted
                  ? "#34A2DF"
                  : isActive
                    ? "#34A2DF"
                    : "#a3a3a3",
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function SignupScreen() {
  const activeStep = useSignupStore((s) => s.activeStep);

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: "#000" }}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 100 }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={120}
      enabled={true}
    >
      <View className="items-center gap-4 pt-10 px-6">
        <View className="items-center gap-1">
          <Text className="text-3xl font-bold text-foreground">
            Create your account
          </Text>
          <Text className="text-muted-foreground">
            Complete the steps below to get started
          </Text>
        </View>
      </View>

      <StepIndicator activeStep={activeStep} />

      <View className="flex-1 px-5">
        {activeStep === 0 && <SignUpStep1 />}
        {activeStep === 1 && <SignUpStep3 />}
        {activeStep === 2 && <SignUpStep2 />}
      </View>
    </KeyboardAwareScrollView>
  );
}
