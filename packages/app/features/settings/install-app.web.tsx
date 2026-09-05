"use client";

import { useRouter } from "solito/navigation";
import { X } from "lucide-react";
import { PwaInstallContent } from "@dvnt/app/components/pwa-install.web";

/** Settings → Install the app. Same instructions as the first-open popup. */
export function InstallAppScreen() {
  const router = useRouter();

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Install the app</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>
      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <div className="rounded-2xl bg-white/4 border border-white/10 p-5">
          <PwaInstallContent />
        </div>
      </main>
    </div>
  );
}
