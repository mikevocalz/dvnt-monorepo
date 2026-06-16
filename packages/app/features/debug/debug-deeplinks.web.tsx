"use client";

/**
 * Deep Link Tester — web port of native `app/(protected)/debug-deeplinks.tsx`.
 *
 * Paste a URL, run the SAME portable parse pipeline native uses, see resolved
 * route + policy + navigation target. Then optionally navigate.
 *
 * Law 1 (data wiring): imports the EXACT portable deep-link helpers the native
 * screen imports — `parseIncomingUrl`, `routePolicy`, `resolveNavigationTarget`,
 * `ROUTE_REGISTRY` — plus the portable `useDeepLinkStore` (pendingLink). The
 * parse/policy/target output strings are byte-for-byte the native layout.
 * State is Zustand (no useState) — a tiny local `useDeepLinkTesterStore` holds
 * the input URL + result string.
 *
 * Native-only bit made web-native: native called `handleDeepLink(url)` which
 * drives expo-router. On web we resolve the target via the portable
 * `resolveNavigationTarget`, surface the resolved web path, and open it via the
 * solito router (router.push) / window.location — same link list, web mechanics.
 */

import { useRouter } from "solito/navigation";
import { create } from "zustand";
import { ChevronLeft, Play, Copy, Link2 } from "lucide-react";
import {
  parseIncomingUrl,
  routePolicy,
  resolveNavigationTarget,
  ROUTE_REGISTRY,
} from "@dvnt/app/lib/deep-linking";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";

const SAMPLE_URLS = [
  "https://dvntapp.live/u/mikevocalz",
  "https://dvntapp.live/p/42",
  "https://dvntapp.live/e/7",
  "https://dvntapp.live/story/15",
  "https://dvntapp.live/messages",
  "https://dvntapp.live/auth/reset?token=abc123",
  "dvnt://u/mikevocalz",
  "dvnt://p/42",
  "dvnt://settings/close-friends",
  "https://dvntapp.live/unknown-route",
];

interface DeepLinkTesterState {
  url: string;
  result: string | null;
  webPath: string | null;
  setUrl: (url: string) => void;
  setResult: (result: string | null, webPath: string | null) => void;
}

const useDeepLinkTesterStore = create<DeepLinkTesterState>((set) => ({
  url: "",
  result: null,
  webPath: null,
  setUrl: (url) => set({ url }),
  setResult: (result, webPath) => set({ result, webPath }),
}));

export function DebugDeeplinksScreen() {
  const router = useRouter();
  const url = useDeepLinkTesterStore((s) => s.url);
  const result = useDeepLinkTesterStore((s) => s.result);
  const webPath = useDeepLinkTesterStore((s) => s.webPath);
  const setUrl = useDeepLinkTesterStore((s) => s.setUrl);
  const setResult = useDeepLinkTesterStore((s) => s.setResult);
  const pendingLink = useDeepLinkStore((s) => s.pendingLink);

  const handleTest = () => {
    if (!url.trim()) return;
    const trimmed = url.trim();
    const parsed = parseIncomingUrl(trimmed);
    const policy = parsed ? routePolicy(parsed.path) : null;
    const target = parsed ? resolveNavigationTarget(parsed) : null;

    const output = [
      `── Parse Result ──`,
      parsed
        ? [
            `Path: ${parsed.path}`,
            `Router Path: ${parsed.routerPath}`,
            `Params: ${JSON.stringify(parsed.params)}`,
            `Requires Auth: ${parsed.requiresAuth}`,
          ].join("\n")
        : "FAILED TO PARSE",
      "",
      `── Route Policy ──`,
      policy
        ? [
            `Public: ${policy.isPublic}`,
            `Requires Auth: ${policy.requiresAuth}`,
            `Matched: ${policy.matchedEntry?.label || "NONE"}`,
          ].join("\n")
        : "NO POLICY",
      "",
      `── Navigation Target ──`,
      target
        ? [
            `Path: ${target.path}`,
            `Valid: ${target.valid}`,
            target.reason ? `Reason: ${target.reason}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "NO TARGET",
    ].join("\n");

    // Native expo-router paths look like /(protected)/u/[username]. On web the
    // resolved web path strips the route-group segments so the tester shows the
    // real browser destination it would push.
    const resolvedWebPath = target?.valid
      ? target.path.replace(/\/\([^)]*\)/g, "").replace(/\[([^\]]+)\]/g, ":$1") || "/"
      : null;

    setResult(output, resolvedWebPath);
  };

  const handleNavigate = () => {
    if (!url.trim()) return;
    const parsed = parseIncomingUrl(url.trim());
    if (!parsed) {
      setResult("FAILED TO PARSE — cannot navigate", null);
      return;
    }
    const target = resolveNavigationTarget(parsed);
    if (!target.valid) {
      handleTest();
      return;
    }
    const dest =
      target.path.replace(/\/\([^)]*\)/g, "").replace(/\[([^\]]+)\]/g, "") || "/";
    router.push(dest);
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button onClick={() => router.back()} aria-label="Back" className="active:scale-95">
          <ChevronLeft size={24} color="#fff" />
        </button>
        <h1 className="flex-1 text-lg font-semibold">Deep Link Tester</h1>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* URL Input */}
        <div className="mb-4 rounded-xl bg-white/4 p-3">
          <p className="mb-2 text-xs font-semibold text-white/60">PASTE URL</p>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dvntapp.live/u/mikevocalz"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="mb-4 flex gap-3">
          <button
            onClick={handleTest}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3FDCFF] py-3 font-semibold text-black active:scale-[0.99]"
          >
            <Copy size={16} color="#000" />
            Parse
          </button>
          <button
            onClick={handleNavigate}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white active:scale-[0.99]"
            style={{ backgroundColor: "#8A40CF" }}
          >
            <Play size={16} color="#fff" />
            Navigate
          </button>
        </div>

        {/* Result */}
        {result && (
          <div className="mb-4 rounded-xl bg-white/4 p-4">
            <p className="mb-2 text-xs font-semibold text-white/60">RESULT</p>
            <pre className="whitespace-pre-wrap font-mono text-xs text-white">{result}</pre>
            {webPath && (
              <p className="mt-3 text-xs text-white/60">
                Resolved web path:{" "}
                <span className="font-mono text-[#3FDCFF]">{webPath}</span>
              </p>
            )}
          </div>
        )}

        {/* Pending Link (portable store) */}
        <div className="mb-4 rounded-xl bg-white/4 p-4">
          <p className="mb-2 text-xs font-semibold text-white/60">PENDING LINK</p>
          <p className="text-xs text-white">
            {pendingLink
              ? `${pendingLink.path} (${pendingLink.originalUrl})`
              : "None"}
          </p>
        </div>

        {/* Sample URLs */}
        <p className="mb-2 text-xs font-semibold text-white/60">SAMPLE URLS</p>
        {SAMPLE_URLS.map((sampleUrl) => (
          <button
            key={sampleUrl}
            onClick={() => setUrl(sampleUrl)}
            className="mb-2 flex w-full items-center gap-2 rounded-lg bg-white/4 px-3 py-2.5 text-left active:bg-white/8"
          >
            <Link2 size={14} color="#666" />
            <span className="flex-1 truncate text-xs text-white">{sampleUrl}</span>
          </button>
        ))}

        {/* Route Registry (portable) */}
        <p className="mt-4 mb-2 text-xs font-semibold text-white/60">
          ROUTE REGISTRY ({ROUTE_REGISTRY.length} routes)
        </p>
        {ROUTE_REGISTRY.map((entry) => (
          <div
            key={entry.urlPattern}
            className="mb-1 flex items-center justify-between rounded-lg bg-white/4 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{entry.urlPattern}</p>
              <p className="truncate text-[10px] text-white/60">{entry.label}</p>
            </div>
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor:
                  entry.auth === "public"
                    ? "rgba(74, 222, 128, 0.15)"
                    : "rgba(138, 64, 207, 0.15)",
                color: entry.auth === "public" ? "#4ADE80" : "#8A40CF",
              }}
            >
              {entry.auth}
            </span>
          </div>
        ))}
      </main>
    </div>
  );
}

export default DebugDeeplinksScreen;
