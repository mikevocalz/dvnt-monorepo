import { Redirect } from "expo-router";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export default function IndexRoute() {
  const authStatus = useAuthStore((s) => s.authStatus);
  const hasSeenOnboarding = useAuthStore((s) => s.hasSeenOnboarding);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  if (!hasHydrated) {
    return null;
  }

  if (isAuthenticated) {
    return <Redirect href="/(protected)/(tabs)" />;
  }

  if (authStatus === "loading") {
    return null;
  }

  if (!hasSeenOnboarding) {
    return <Redirect href="/(auth)/onboarding" />;
  }

  return <Redirect href="/(public)/(tabs)" />;
}
