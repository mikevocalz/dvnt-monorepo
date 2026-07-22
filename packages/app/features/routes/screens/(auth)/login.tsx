import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { toast } from "sonner-native";
import { useForm } from "@tanstack/react-form";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { FormInput } from "@dvnt/app/components/form";
import { Button } from "@dvnt/app/components/ui/button";
import { router } from "expo-router";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { signIn } from "@dvnt/app/lib/auth-client";
import { auth } from "@dvnt/app/lib/api/auth";
import { syncAuthUser } from "@dvnt/app/lib/api/privileged";
import { replayPendingLink } from "@dvnt/app/lib/deep-linking/link-engine";
import { useOnboardingV2Store } from "@dvnt/app/lib/stores/onboarding-v2-store";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";
import Logo from "@dvnt/app/components/logo";
import { VideoView, useVideoPlayer } from "expo-video";
import { AppleButton } from "@dvnt/app/components/auth/apple-button";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoLifecycle, logVideoHealth } from "@dvnt/app/lib/video-lifecycle";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function LoginScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { setUser } = useAuthStore();

  // CRITICAL: Video lifecycle management to prevent crashes
  const { isMountedRef } = useVideoLifecycle("LoginScreen", "background");

  // Background video player
  const backgroundVideo = useVideoPlayer(
    require("@dvnt/app/assets/dvntappbackground.mp4"),
    (player) => {
      if (isMountedRef.current) {
        player.loop = true;
        player.muted = true;
        player.play();
        logVideoHealth("LoginScreen", "background video started");
      }
    },
  );

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);

      try {
        if (__DEV__) console.log("[Login] Attempting login for:", value.email);
        const { data, error } = await signIn.email({
          email: value.email,
          password: value.password,
        });

        if (__DEV__)
          console.log(
            "[Login] Response - data:",
            JSON.stringify(data),
            "error:",
            JSON.stringify(error),
          );

        if (error) {
          throw new Error(error.message || "Login failed");
        }

        if (data?.user) {
          if (__DEV__) {
            console.log(
              "[Login] Better Auth success, user:",
              data.user.id,
              data.user.email,
            );
            console.log(
              "[Login] Session token present:",
              !!(data as any)?.session?.token,
            );
          }

          // Sync user to app's users table (creates row if needed, updates auth_id)
          let profile;
          try {
            if (__DEV__) console.log("[Login] Calling syncAuthUser...");
            profile = await syncAuthUser();
            if (__DEV__) console.log("[Login] User synced, ID:", profile.id);
          } catch (syncError: any) {
            console.warn(
              "[Login] syncAuthUser failed:",
              syncError?.message || syncError,
            );
            if (__DEV__) console.log("[Login] Falling back to getProfile...");
            profile = await auth.getProfile(data.user.id, data.user.email);
            if (__DEV__)
              console.log(
                "[Login] getProfile result:",
                profile ? profile.id : "null",
              );
          }

          if (profile) {
            if (__DEV__) console.log("[Login] Profile loaded, ID:", profile.id);
            setUser({
              id: profile.id,
              email: profile.email,
              username: profile.username,
              name: profile.name,
              avatar: profile.avatar || "",
              bio: profile.bio || "",
              website: (profile as any).website || "",
              location: profile.location || "",
              hashtags: (profile as any).hashtags || [],
              isVerified: profile.isVerified,
              postsCount: profile.postsCount,
              followersCount: profile.followersCount,
              followingCount: profile.followingCount,
            });
            // Replay pending deep link if one was saved, otherwise go to home
            const pending = useDeepLinkStore.getState().pendingLink;
            if (pending) {
              replayPendingLink();
            } else if (
              // B1/B2: first sign-in on this install → welcome flow. The
              // screen self-skips when the profile already has the data.
              useOnboardingV2Store.getState().steps["welcome"] !== "done"
            ) {
              router.replace("/(protected)/welcome" as any);
            } else {
              router.replace("/(protected)/(tabs)" as any);
            }
          } else {
            console.error("[Login] Could not load profile for:", data.user.id);
            toast.error("Login Failed", {
              description: "Could not load user profile from database",
            });
          }
        } else {
          toast.error("Login Failed", {
            description: "Could not load user profile",
          });
        }
      } catch (error: any) {
        console.error("[Login] Error:", error);

        // Network error - auth server not available
        if (
          error?.message?.includes("fetch") ||
          error?.message?.includes("network")
        ) {
          toast.error("Connection Error", {
            description:
              "Unable to connect to auth server. Please try again later.",
          });
        } else {
          toast.error("Login Failed", {
            description:
              error?.message || "Something went wrong. Please try again.",
          });
        }
      }

      setIsSubmitting(false);
    },
  });

  return (
    <View style={styles.container}>
      {/* Background Video */}
      <VideoView
        player={backgroundVideo}
        style={styles.backgroundVideo}
        contentFit="cover"
        nativeControls={false}
      />

      {/* Gradient overlay - transparent at top, black at bottom (starts at 47%) */}
      <LinearGradient
        colors={[
          "transparent",
          "transparent",
          "rgba(0,0,0,0.3)",
          "rgba(0,0,0,0.7)",
          "#000",
        ]}
        locations={[0, 0.47, 0.6, 0.8, 1]}
        style={styles.overlay}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View className="gap-6">
          <View className="items-center gap-8">
            {/* <Logo width={200} height={80} /> */}
            <View className="items-center my-8">
              <Text className="text-3xl font-bold text-foreground">
                Welcome back
              </Text>
              <Text className="text-muted-foreground mt-4">
                Sign in to your account to continue
              </Text>
            </View>
          </View>

          <View className="gap-4">
            <FormInput
              form={form}
              name="email"
              label="Email"
              labelClassName="text-white"
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

            <FormInput
              form={form}
              name="password"
              label="Password"
              labelClassName="text-white"
              placeholder="Enter your password"
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

            <View className="items-end">
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/(auth)/forgot-password",
                    params: { email: form.getFieldValue("email") || "" },
                  } as any)
                }
              >
                <Text className="text-primary text-sm">Forgot password?</Text>
              </Pressable>
            </View>

            <Button
              onPress={form.handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>

            {/* Sign in with Apple */}
            <AppleButton
              onSuccess={(user) => {
                setUser(user);
                const pending = useDeepLinkStore.getState().pendingLink;
                if (pending) {
                  replayPendingLink();
                } else {
                  router.replace("/(protected)/(tabs)" as any);
                }
              }}
              onError={(error) => {
                toast.error("Apple Sign In Failed", {
                  description: error.message || "Please try again",
                });
              }}
            />
          </View>

          <View className="items-center gap-2">
            <View className="flex-row items-center gap-2 w-full">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-muted-foreground text-xs">Or</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            <View className="flex-row items-center gap-1">
              <Text className="text-muted-foreground">
                Don't have an account?
              </Text>
              <Pressable onPress={() => router.push("/(auth)/signup" as any)}>
                <Text className="text-primary font-medium">Sign up</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  backgroundVideo: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
});
