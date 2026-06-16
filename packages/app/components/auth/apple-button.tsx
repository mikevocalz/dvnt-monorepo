import { useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { signIn } from "@dvnt/app/lib/auth-client";
import { syncAuthUser } from "@dvnt/app/lib/api/privileged";
import type { AppUser } from "@dvnt/app/lib/auth-client";

interface AppleButtonProps {
  onSuccess: (user: AppUser) => void;
  onError: (error: Error) => void;
}

export function AppleButton({ onSuccess, onError }: AppleButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  if (Platform.OS !== "ios") return null;

  const handleAppleSignIn = async () => {
    setIsLoading(true);
    try {
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        throw new Error("Sign in with Apple is not available on this device");
      }

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token");
      }

      // Better Auth still runs in the Supabase Edge Function. The native iOS
      // sheet only supplies Apple's identity token; Better Auth verifies it,
      // creates/links the account, sets the session cookie, and the Expo
      // client plugin stores that cookie in SecureStore.
      const result = await signIn.social({
        provider: "apple",
        idToken: {
          token: credential.identityToken,
          user: {
            email: credential.email ?? undefined,
            name: {
              firstName: credential.fullName?.givenName ?? undefined,
              lastName: credential.fullName?.familyName ?? undefined,
            },
          },
        },
      });

      if (result.error) {
        throw new Error(result.error.message || "Apple sign in failed");
      }

      // BA session is now in SecureStore. Mirror the BA user into our
      // public.users table so the rest of the app has the integer
      // users.id available.
      const profile = await syncAuthUser();
      if (!profile) throw new Error("Failed to sync user profile");

      const user: AppUser = {
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
      };

      onSuccess(user);
    } catch (error: any) {
      const code = String(error?.code || "").toLowerCase();
      const msg = String(error?.message || error || "").toLowerCase();
      if (
        code.includes("canceled") ||
        msg.includes("cancel") ||
        msg.includes("dismiss") ||
        msg.includes("user_cancelled")
      ) {
        return;
      }
      console.error("[AppleButton] Sign in error:", error);
      onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={{ minHeight: 54 }}>
      {isLoading ? (
        <View
          accessibilityRole="button"
          accessibilityLabel="Sign in with Apple"
          style={{
            alignItems: "center",
            backgroundColor: "#fff",
            borderRadius: 12,
            height: 54,
            justifyContent: "center",
          }}
        >
          <ActivityIndicator size="small" color="#000" />
        </View>
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          }
          cornerRadius={12}
          onPress={handleAppleSignIn}
          style={{ height: 54, width: "100%" }}
        />
      )}
    </View>
  );
}
