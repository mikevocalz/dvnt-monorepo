"use client";

/**
 * OTA Diagnostics — web port of native `app/(protected)/debug-ota.tsx`.
 *
 * The native screen is a thin UI over `expo-updates` (isEmbeddedLaunch,
 * updateId, channel, runtimeVersion, checkForUpdateAsync, fetchUpdateAsync,
 * reloadAsync). OTA does not exist on the web platform.
 *
 * Native-only bits made informational (per spec):
 *  - expo-updates is NOT imported (it breaks the web bundle). Instead we show a
 *    prominent "OTA not applicable on web" banner.
 *  - checkForUpdateAsync / fetchUpdateAsync / reloadAsync actions are rendered
 *    read-only/disabled with an explanatory note (web ships via the deploy, not
 *    OTA).
 *
 * Portable build-info that DOES apply on web is shown faithfully in the same
 * Row/Section layout: appVersion, appEnv, platform (web), capturedAt, plus the
 * channel/runtimeVersion env values when present. State is Zustand (no
 * useState) — a tiny `useOtaDiagStore` holds the capturedAt snapshot so the
 * refresh button re-captures, mirroring native.
 */

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { create } from "zustand";
import { ChevronLeft, RefreshCw, Copy, AlertTriangle } from "lucide-react";

interface WebBuildInfo {
  capturedAt: string;
  appVersion: string;
  appEnv: string;
  channel: string | null;
  runtimeVersion: string | null;
  platform: string;
}

function captureWebBuildInfo(): WebBuildInfo {
  const appVersion =
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.EXPO_PUBLIC_APP_VERSION ??
    "unknown";
  const appEnv =
    process.env.NEXT_PUBLIC_APP_ENV ??
    process.env.EXPO_PUBLIC_APP_ENV ??
    process.env.NODE_ENV ??
    "unknown";
  const channel =
    process.env.NEXT_PUBLIC_RELEASE_CHANNEL ??
    process.env.EXPO_PUBLIC_RELEASE_CHANNEL ??
    null;
  const runtimeVersion =
    process.env.NEXT_PUBLIC_RUNTIME_VERSION ??
    process.env.EXPO_PUBLIC_RUNTIME_VERSION ??
    null;
  return {
    capturedAt: new Date().toISOString(),
    appVersion,
    appEnv,
    channel,
    runtimeVersion,
    platform: typeof navigator !== "undefined" ? `web · ${navigator.userAgent}` : "web",
  };
}

interface OtaDiagState {
  info: WebBuildInfo;
  recapture: () => void;
}

const useOtaDiagStore = create<OtaDiagState>((set) => ({
  info: captureWebBuildInfo(),
  recapture: () => set({ info: captureWebBuildInfo() }),
}));

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3 border-b border-white/6 py-2">
      <span className="w-[180px] text-[13px] font-semibold text-white">{label}</span>
      <span
        className={`flex-1 text-[13px] text-white/60 ${mono ? "font-mono" : ""}`}
        style={{ overflowWrap: "anywhere" }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="mt-5 mb-1 text-[11px] font-bold uppercase tracking-[1.2px] text-white/60">
      {title}
    </p>
  );
}

export function DebugOtaScreen() {
  const router = useRouter();
  const info = useOtaDiagStore((s) => s.info);
  const recapture = useOtaDiagStore((s) => s.recapture);

  useEffect(() => {
    console.log("[OTA-DIAG] ========== OTA DIAGNOSTICS (web) ==========");
    console.log("[OTA-DIAG] OTA not applicable on web platform");
    console.log("[OTA-DIAG] appVersion:", info.appVersion);
    console.log("[OTA-DIAG] appEnv:", info.appEnv);
    console.log("[OTA-DIAG] channel:", info.channel);
    console.log("[OTA-DIAG] runtimeVersion:", info.runtimeVersion);
    console.log("[OTA-DIAG] ==========================================");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyAll = () => {
    const text = JSON.stringify({ ota: "not-applicable-on-web", ...info }, null, 2);
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* non-blocking */
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="mr-3 active:scale-95"
        >
          <ChevronLeft size={22} color="#fff" />
        </button>
        <div className="flex-1">
          <h1 className="text-[17px] font-bold">OTA Diagnostics</h1>
          <p className="text-[11px] text-white/60">expo-updates — native only</p>
        </div>
        <button onClick={copyAll} aria-label="Copy" className="mr-2">
          <Copy size={18} color="#71717a" />
        </button>
        <button onClick={recapture} aria-label="Re-capture">
          <RefreshCw size={18} color="#71717a" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-4">
        {/* OTA-not-applicable banner */}
        <div className="mb-4 flex gap-2.5 rounded-xl border border-[#FF9F0A] bg-[#FF9F0A]/12 p-3">
          <AlertTriangle size={18} color="#FF9F0A" />
          <div className="flex-1">
            <p className="text-[13px] font-bold text-[#FF9F0A]">OTA not applicable on web</p>
            <p className="mt-0.5 text-xs text-[#FF9F0A]">
              expo-updates ships JS bundles over-the-air to native binaries. The
              web app updates via its deployment, so embedded/update/channel
              fetch and reload actions do not apply here.
            </p>
          </div>
        </div>

        {/* Portable build config */}
        <SectionHeader title="Build Config (web)" />
        <Row label="appVersion" value={info.appVersion} />
        <Row label="appEnv" value={info.appEnv} />
        <Row label="channel" value={info.channel} mono />
        <Row label="runtimeVersion" value={info.runtimeVersion} mono />
        <Row label="platform" value={info.platform} />
        <Row label="capturedAt" value={info.capturedAt} />

        {/* Native actions — informational/read-only on web */}
        <SectionHeader title="Actions (native only)" />
        <div className="mt-2 rounded-xl border border-white/12 bg-white/4 p-4 opacity-60">
          <p className="text-[13px] font-semibold text-white">checkForUpdateAsync()</p>
          <p className="mt-0.5 text-xs text-white/60">
            Native-only. No OTA channel to query on web.
          </p>
        </div>
        <div className="mt-2 rounded-xl border border-white/12 bg-white/4 p-4 opacity-60">
          <p className="text-[13px] font-semibold text-white">fetchUpdateAsync()</p>
          <p className="mt-0.5 text-xs text-white/60">
            Native-only. Web bundles are not fetched over-the-air.
          </p>
        </div>
        <div className="mt-2 rounded-xl border border-white/12 bg-white/4 p-4 opacity-60">
          <p className="text-[13px] font-semibold text-white">
            reloadAsync() — apply &amp; restart
          </p>
          <p className="mt-0.5 text-xs text-white/60">
            Native-only. Use a hard browser refresh to reload the web app.
          </p>
        </div>

        <p className="mt-4 whitespace-pre-line text-center text-[11px] text-white/60">
          {`Build info logged to console on screen mount.
Use Copy to export JSON for incident reports.`}
        </p>
      </main>
    </div>
  );
}

export default DebugOtaScreen;
