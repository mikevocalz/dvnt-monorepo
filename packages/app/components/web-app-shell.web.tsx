/**
 * Web app shell (shared) — the content frame for app surfaces. The header and
 * tab bar are NOT here anymore: they're rendered once by SiteChrome in the Next
 * root layout so they persist across navigation (no remount/jump). This shell
 * only owns the dark canvas, the client-side auth gate, and the top-padding that
 * clears the fixed header.
 *
 * - requireAuth (default): logged-out visitors are redirected to the public site.
 * - requireAuth={false} (public surfaces like /events): the SAME screen renders
 *   for logged-out visitors; SiteChrome shows them the marketing header instead
 *   of the app header. Per-section gating (members-only comments / attendees)
 *   happens inside the screen.
 */
import { useEffect } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, usePathname } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { routeOwnsHeader } from "@dvnt/app/lib/web-chrome";

export function WebAppShell({
  children,
  requireAuth = true,
}: {
  children: React.ReactNode;
  /** Gate to authed users (default). Set false for public surfaces like /events
   * — the SAME screen renders for logged-out visitors; what's shown is gated by
   * auth inside the screen + server-side RLS, not by redirecting them away. */
  requireAuth?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  // Sub-screens that render their own top header get no global header from
  // SiteChrome, so they need no header-clearance padding either.
  const ownsHeader = routeOwnsHeader(pathname);

  useEffect(() => {
    if (requireAuth && hasHydrated && !isAuthenticated) {
      // Logged out → the public landing / main site (not the login screen).
      router.replace("/");
    }
  }, [requireAuth, hasHydrated, isAuthenticated, router]);

  // On public surfaces a logged-out visitor sees the (taller) marketing header
  // from SiteChrome → give the content ~100px of clearance; authed app chrome
  // clears the shorter app header.
  const publicChrome = !requireAuth && hasHydrated && !isAuthenticated;

  return (
    <View style={styles.root}>
      <Main
        style={
          ownsHeader
            ? undefined
            : publicChrome
              ? styles.contentPublic
              : [styles.content, isMobile && styles.contentMobile]
        }
      >
        {children}
      </Main>
    </View>
  );
}

// Header offset: the desktop app header floats (taller); the mobile header is
// flush (~56px). Safe-area-aware for notched phones in standalone/PWA mode.
const styles = StyleSheet.create({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: { minHeight: "100vh" as any, backgroundColor: "#02030A" },
  // The rail AppShell (site-chrome) is now the authed shell and renders NO fixed
  // top header, so the old WebAppHeader offset is a phantom gap above every app
  // screen — zero it out. (The feed self-balances its own -78/+78 so it stays
  // flush either way.) Mobile keeps only notch clearance.
  content: { paddingTop: 0 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contentMobile: { paddingTop: "env(safe-area-inset-top)" as any },
  // Public marketing chrome (GlassHeader floats taller): ~100px clearance.
  contentPublic: { paddingTop: 100 },
});
