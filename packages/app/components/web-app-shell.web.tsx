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
import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Main } from "@dvnt/app/components/ui/html";
import { useRouter, usePathname } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { routeIsImmersive, routeOwnsHeader } from "@dvnt/app/lib/web-chrome";
import { clearReviewReturnOutsideSetup } from "@dvnt/app/lib/auth/review-return";
import { guestEventRoute } from "@dvnt/app/lib/auth/guest-event-route";
import { roomReturnPath } from "@dvnt/app/lib/auth/room-return";
import { loginPathWithReturn } from "@dvnt/app/lib/auth/return-to";
import { getSession, resumeAuthSession } from "@dvnt/app/lib/auth-client";
import { syncAuthUser } from "@dvnt/app/lib/api/privileged";
import { hydrateAuthProfile } from "@dvnt/app/lib/auth/hydrate-auth-profile";
import { captureAuthContinuation } from "@dvnt/app/lib/auth/continuation-guard";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

function matchesSessionProfile(profile: { id: string; authId?: string } | null, user: { id: string }) {
  if (!profile) return false;
  if (profile.authId) return profile.authId === user.id;
  return profile.id === user.id;
}

let roomSessionRead: { epoch: number; promise: ReturnType<typeof getSession> } | undefined;
function readRoomSession() {
  const epoch = getSessionLifecycle().epoch;
  if (roomSessionRead?.epoch === epoch) return roomSessionRead.promise;
  const promise = getSession();
  const request = { epoch, promise };
  roomSessionRead = request;
  void promise.then(
    () => { if (roomSessionRead === request) roomSessionRead = undefined; },
    () => { if (roomSessionRead === request) roomSessionRead = undefined; },
  );
  return promise;
}

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authStatus = useAuthStore((s) => s.authStatus);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const [sessionError, setSessionError] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const needsRoomSession = requireAuth && /^\/feed\/sneaky-lynk\/room(?:\/|$)/.test(pathname);
  // Sub-screens that render their own top header get no global header from
  // SiteChrome, so they need no header-clearance padding either.
  const ownsHeader = routeOwnsHeader(pathname);
  // Immersive surfaces (call, camera, story) get no chrome at all — the tab-bar
  // clearance would be dead space pushing the controls band off the viewport.
  const immersive = routeIsImmersive(pathname);

  // Native bootstraps auth in its root layout. Next does not mount that root,
  // and authStatus is deliberately not persisted. Validate the browser session
  // before admitting a refreshed/deep-linked page, rather than waiting forever
  // on "loading" or trusting a saved profile as an active login.
  useEffect(() => {
    if (!needsRoomSession || !hasHydrated || authStatus !== "loading") return;
    let active = true;
    let continuation = captureAuthContinuation();
    const stillCurrent = () => active && continuation.isCurrent();
    const timeout = setTimeout(() => {
      if (active && useAuthStore.getState().authStatus === "loading") setSessionError(true);
      active = false;
      continuation.release();
      // A stalled request must not capture the retry forever.
      roomSessionRead = undefined;
    }, 10_000);
    setSessionError(false);
    void (async () => {
      try {
        const { data, error } = await readRoomSession();
        if (!stillCurrent()) return;
        if (error) throw error;
        if (!data?.session || !data.user) {
          continuation.release();
          useAuthStore.getState().setUser(null);
          return;
        }
        const saved = useAuthStore.getState().user;
        if (saved && matchesSessionProfile(saved, data.user)) {
          continuation.release();
          useAuthStore.getState().setUser(hydrateAuthProfile(saved));
          return;
        }
        // A fresh browser can have a real session cookie with no saved app
        // profile (including verification in a new tab). Resume validates the
        // cookie and invalidates tokens from a previous locally cached account.
        continuation.release();
        continuation = captureAuthContinuation({ includeSession: false });
        const resumed = await resumeAuthSession();
        if (!stillCurrent()) return;
        const sessionOwner = getSessionLifecycle().authId;
        if (!resumed || (sessionOwner && sessionOwner !== data.user.id)) throw new Error("Session changed while restoring login");
        continuation.release();
        continuation = captureAuthContinuation();
        const profile = await syncAuthUser();
        if (!stillCurrent()) return;
        if (!matchesSessionProfile(profile, data.user)) throw new Error("Profile unavailable or belongs to a different session");
        continuation.release();
        useAuthStore.getState().setUser(hydrateAuthProfile(profile));
      } catch {
        if (stillCurrent()) setSessionError(true);
      } finally {
        clearTimeout(timeout);
        // Cross-tab/session-only changes need not update the profile store.
        // A superseded bootstrap must offer a fresh check, not stay blank in
        // "loading" forever after its old request is safely discarded.
        if (active && useAuthStore.getState().authStatus === "loading" && !continuation.isCurrent()) setSessionError(true);
        continuation.release();
      }
    })();
    return () => { active = false; clearTimeout(timeout); continuation.release(); };
  }, [needsRoomSession, hasHydrated, authStatus, sessionAttempt]);

  useEffect(() => {
    if (hasHydrated) clearReviewReturnOutsideSetup(pathname);
  }, [hasHydrated, pathname]);

  useEffect(() => {
    if (requireAuth && hasHydrated && (!needsRoomSession || authStatus !== "loading") && !isAuthenticated) {
      // Existing/shared event links must keep guests on that event. Only the
      // exact detail route has a public equivalent; reviews retain their login
      // return target, while member tools stay gated.
      const room = roomReturnPath(pathname);
      router.replace(room ? loginPathWithReturn(room) : guestEventRoute(pathname, window.location.search) ?? "/");
    }
  }, [requireAuth, hasHydrated, isAuthenticated, authStatus, needsRoomSession, pathname, router]);

  // A redirect effect runs after child effects. Do not mount protected room
  // lookups, pre-join devices or admission code for a guest while redirecting.
  // Public event surfaces explicitly use requireAuth={false} and still render.
  if (requireAuth && (!hasHydrated || !isAuthenticated || (needsRoomSession && authStatus !== "authenticated"))) {
    if (needsRoomSession) return (
      <section aria-busy={!sessionError} className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 bg-[#06070D] px-6 py-12 text-center text-white">
        {!sessionError ? <span aria-hidden="true" className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-[#3FDCFF] motion-reduce:animate-none" /> : null}
        <div role={sessionError ? "alert" : "status"} className="max-w-sm space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3FDCFF]">Sneaky Lynk</p>
          <h1 className="text-2xl font-semibold">{sessionError ? "Unable to confirm your sign-in" : "Checking your sign-in"}</h1>
          <p className="text-sm leading-6 text-white/65">{sessionError ? "Check your connection and try again to continue to this Lynk." : "Getting this room ready for your signed-in account."} Your camera and microphone stay off.</p>
        </div>
        {sessionError ? <button type="button" onClick={() => setSessionAttempt(n => n + 1)} className="min-h-12 w-full max-w-sm rounded-xl bg-[#3FDCFF] px-5 py-3 font-semibold text-[#06070D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Try again</button> : null}
      </section>
    );
    return null;
  }

  // On public surfaces a logged-out visitor sees the (taller) marketing header
  // from SiteChrome → give the content ~100px of clearance; authed app chrome
  // clears the shorter app header.
  const publicChrome = !requireAuth && hasHydrated && !isAuthenticated;

  return (
    <View style={styles.root}>
      {/* The mobile notch clearance is a CSS breakpoint, not a JS branch.
          It used to read `useWindowDimensions()`, which returns a fallback
          width during server rendering — so the server picked the mobile
          padding and the client picked the desktop one, and React reported a
          hydration mismatch on every load of the app shell
          (`r-paddingTop-10xqauy` vs `r-paddingTop-wk8lta`). A media query is
          resolved by the browser after the HTML is already correct. */}
      <Main
        className={
          // Bottom clearance for EVERY app screen, not per page.
          //
          // The phone tab bar is fixed, so the last thing on any screen sits
          // under it — the dashboard's final row, the scanner's recent-scans
          // list, a guest list's last attendee. Each screen was left to
          // remember its own padding and none of them did. `lg:` drops it
          // because the desktop rail is a sidebar, not a bottom bar, and the
          // safe-area term carries the home indicator on notched phones.
          [
            ownsHeader || publicChrome || immersive
              ? ""
              : "pt-[env(safe-area-inset-top)] md:pt-0",
            immersive ? "" : "pb-[calc(env(safe-area-inset-bottom)+88px)] lg:pb-10",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        style={
          ownsHeader ? undefined : publicChrome ? styles.contentPublic : undefined
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
  // screen — zero it out. Mobile keeps only notch clearance, applied above as a
  // `md:` breakpoint so it survives server rendering.
  // Public marketing chrome (GlassHeader floats taller): ~100px clearance.
  contentPublic: { paddingTop: 100 },
});
