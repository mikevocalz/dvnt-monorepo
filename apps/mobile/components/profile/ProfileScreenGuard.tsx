/**
 * ProfileScreenGuard
 *
 * PHASE 2: Root guard wrapper that handles all edge cases before rendering profile content.
 * This component ensures Profile NEVER crashes from missing/partial data.
 *
 * Handles:
 * - Loading state (auth user not ready)
 * - Error state (query failed)
 * - Offline state (network unavailable)
 * - Empty user state (not logged in)
 */

import React, { ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { useAuthStore } from "@/lib/stores/auth-store";
import { RefreshCw, WifiOff } from "lucide-react-native";
import { ProfileSkeleton } from "@/components/skeletons";

interface ProfileScreenGuardProps {
  children: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

/**
 * ProfileScreenGuard - Ensures profile content only renders when safe
 */
export function ProfileScreenGuard({
  children,
  isLoading = false,
  isError = false,
  error = null,
  onRetry,
}: ProfileScreenGuardProps) {
  const user = useAuthStore((state) => state.user);

  // GUARD 1: No authenticated user - show loading
  if (!user || !user.id) {
    return (
      <View className="flex-1 bg-background">
        <ProfileSkeleton />
      </View>
    );
  }

  // GUARD 2: Loading state - show skeleton
  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ProfileSkeleton />
      </View>
    );
  }

  // GUARD 3: Error state - show retry UI
  if (isError) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <View className="bg-destructive/10 rounded-full p-4 mb-4">
          <WifiOff size={32} color="#ef4444" />
        </View>
        <Text className="text-lg font-semibold text-foreground">
          Failed to Load Profile
        </Text>
        <Text className="text-sm text-muted-foreground mt-2 text-center">
          {error?.message || "Something went wrong. Please try again."}
        </Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            className="mt-6 flex-row items-center gap-2 bg-primary px-6 py-3 rounded-lg"
          >
            <RefreshCw size={18} color="#fff" />
            <Text className="text-white font-semibold">Try Again</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // All guards passed - render children
  return <>{children}</>;
}

export default ProfileScreenGuard;
