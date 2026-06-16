"use client";

/**
 * Transition Lab — web port of native `app/(protected)/debug/transitions.tsx`.
 *
 * The native screen is a QA harness for `react-native-screen-transitions`
 * (shared-element / bound-tag transitions): a feed post, masonry grid, story
 * tray, event card, and ticket preview each transition into their detail route.
 *
 * Native-only bits made informational (per spec):
 *  - `react-native-screen-transitions` (Transition.Pressable / sharedBoundTag /
 *    motionTags) and the heavy native feed components (FeedPost,
 *    ProfileMasonryGrid, StoriesBar, FeedEventCard) are NOT imported on web.
 *    Instead each transition demo is listed informationally with the production
 *    route it drives + its deterministic demo source, and a "demo" link that
 *    routes to the same destination via the solito router (a real web route
 *    transition, not the native shared-element animation).
 *
 * Law 1 (data wiring): reuses the portable `useAuthStore` (user id used to
 * build the masonry route just like native) and keeps the exact deterministic
 * DEMO ids/routes the native screen injects into the query cache. State is
 * Zustand (no useState) — none needed beyond the portable store.
 */

import { useRouter } from "solito/navigation";
import { ArrowLeft, Sparkles, ChevronRight } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

// Deterministic ids mirrored from the native transition lab.
const DEMO_FEED_POST_ID = "900001";
const DEMO_MASONRY_POST_ID = "900002";
const DEMO_STORY_ID = "900005";
const DEMO_EVENT_ID = "900003";
const DEMO_TICKET_EVENT_ID = "900004";

interface TransitionDemo {
  title: string;
  subtitle: string;
  source: string;
  webRoute: string;
}

export function DebugTransitionsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const userId = user?.id || "debug-user";

  const demos: TransitionDemo[] = [
    {
      title: "Feed Post → Detail",
      subtitle:
        "Shared card, hero media, and avatar on the production feed post component.",
      source: `post #${DEMO_FEED_POST_ID}`,
      webRoute: `/post/${DEMO_FEED_POST_ID}`,
    },
    {
      title: "Profile Masonry → Viewer",
      subtitle: "The real masonry grid component driving the same post detail route.",
      source: `user ${userId} · post #${DEMO_MASONRY_POST_ID}`,
      webRoute: `/post/${DEMO_MASONRY_POST_ID}`,
    },
    {
      title: "Story Tray → Viewer",
      subtitle:
        "Shared ring-to-viewer transition with deterministic injected story data.",
      source: `story #${DEMO_STORY_ID}`,
      webRoute: `/story/${DEMO_STORY_ID}`,
    },
    {
      title: "Event Card → Detail",
      subtitle:
        "The production event card transitioning into the full event detail screen.",
      source: `event #${DEMO_EVENT_ID}`,
      webRoute: `/events/${DEMO_EVENT_ID}`,
    },
    {
      title: "Ticket Preview → Detail",
      subtitle: "Compact ticket preview transitioning into the luxury pass detail.",
      source: `ticket event #${DEMO_TICKET_EVENT_ID}`,
      webRoute: `/ticket/${DEMO_TICKET_EVENT_ID}`,
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-white/8 bg-white/6 active:scale-95"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-xl font-extrabold">Transition Lab</h1>
          <p className="text-xs text-white/60">Production routes, deterministic sources</p>
        </div>
        <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#3FDCFF]/12">
          <Sparkles size={18} color="#3FDCFF" />
        </div>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Native-transition informational note */}
        <div className="mb-5 rounded-xl border border-white/8 bg-white/4 p-4">
          <p className="text-[13px] font-semibold text-white">
            Native shared-element transitions are informational on web
          </p>
          <p className="mt-1 text-xs text-white/60">
            The native lab uses react-native-screen-transitions (sharedBoundTag /
            motionTags) to animate each source into its detail route. On web,
            navigation uses standard route transitions — each demo below links to
            the same production destination it drives on native.
          </p>
        </div>

        {demos.map((demo) => (
          <button
            key={demo.title}
            onClick={() => router.push(demo.webRoute)}
            className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-[#0D0D10] p-4 text-left transition-colors active:bg-white/6"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold text-white">{demo.title}</p>
              <p className="mt-1 text-[13px] leading-5 text-white/60">{demo.subtitle}</p>
              <p className="mt-2 font-mono text-[11px] text-[#3FDCFF]">
                source: {demo.source} → {demo.webRoute}
              </p>
            </div>
            <ChevronRight size={20} color="#8A40CF" />
          </button>
        ))}
      </main>
    </div>
  );
}

export default DebugTransitionsScreen;
