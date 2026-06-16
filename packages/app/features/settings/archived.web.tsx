"use client";

import { useRouter } from "solito/navigation";
import { Archive, X } from "lucide-react";

/**
 * Archived posts — web (Phase 1 port of `settings/archived.tsx`). The native
 * screen is a "coming soon" empty state with no data wiring; ported verbatim.
 */
export function ArchivedScreen() {
  const router = useRouter();
  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Archived</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <div className="flex flex-col items-center px-6 py-16">
          <div className="w-20 h-20 rounded-2xl bg-white/4 border border-white/10 flex items-center justify-center mb-4">
            <Archive size={48} color="#666" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-white">No Archived Posts</h2>
          <p className="text-center text-sm text-white/50">
            When you archive posts, they&apos;ll appear here. Only you can see archived posts.
          </p>
        </div>
        <div className="mt-2 px-4 pb-8">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-center text-sm text-white/50">
              Post archiving is coming soon. You&apos;ll be able to hide posts from your profile
              without deleting them.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
