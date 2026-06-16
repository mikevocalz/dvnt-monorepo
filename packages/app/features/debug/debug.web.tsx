"use client";

/**
 * Network Debug Screen — web port of native `app/(protected)/debug.tsx`.
 *
 * Internal QA panel that fires the same API probes the native screen runs
 * and reports status code + auth presence + response preview per endpoint.
 *
 * Law 1 (data wiring): reuses the EXACT portable `useAuthStore` the native
 * screen uses for the current user + auth token shape, and hits the same
 * Supabase API base. State is Zustand (no useState) — a tiny local
 * `useDebugNetStore` mirrors the native `results`/`isRunning` local state.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off).
 *
 * Native-only bits made informational on web:
 *  - expo-secure-store token read → on web the native code already branched to
 *    `localStorage.getItem("dvnt_auth_token")`; we keep that exact web path.
 *  - The native `__DEV__` gate is preserved via `process.env.NODE_ENV`.
 */

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { create } from "zustand";
import {
  ChevronLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

const _rawDebugUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL =
  typeof _rawDebugUrl === "string" && _rawDebugUrl.startsWith("https://")
    ? _rawDebugUrl
    : "https://npfjanxturvmjyevoyfo.supabase.co";

interface TestResult {
  name: string;
  status: "pending" | "running" | "pass" | "fail";
  statusCode?: number;
  hasAuth?: boolean;
  error?: string;
  responsePreview?: string;
}

interface DebugNetState {
  isRunning: boolean;
  results: TestResult[];
  setRunning: (v: boolean) => void;
  setResults: (r: TestResult[]) => void;
}

const useDebugNetStore = create<DebugNetState>((set) => ({
  isRunning: false,
  results: [],
  setRunning: (v) => set({ isRunning: v }),
  setResults: (r) => set({ results: r }),
}));

function getAuthToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("dvnt_auth_token");
  } catch (e) {
    console.error("[Debug] getAuthToken error:", e);
    return null;
  }
}

export function DebugScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isRunning = useDebugNetStore((s) => s.isRunning);
  const results = useDebugNetStore((s) => s.results);
  const setRunning = useDebugNetStore((s) => s.setRunning);
  const setResults = useDebugNetStore((s) => s.setResults);

  const runTests = async () => {
    setRunning(true);
    const authToken = getAuthToken();
    const API_BASE = SUPABASE_URL;

    const tests: TestResult[] = [
      { name: "GET /api/users/me", status: "pending" },
      { name: "GET /api/posts?limit=1", status: "pending" },
      { name: "GET /api/posts/feed", status: "pending" },
      { name: `GET /api/users/${user?.id || "15"}/profile`, status: "pending" },
      { name: "GET /api/conversations", status: "pending" },
      { name: "GET /api/stories", status: "pending" },
    ];
    setResults([...tests]);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `JWT ${authToken}`;

    const probes: Array<{ url: string; auth: boolean }> = [
      { url: `${API_BASE}/api/users/me`, auth: true },
      { url: `${API_BASE}/api/posts?limit=1`, auth: false },
      { url: `${API_BASE}/api/posts/feed`, auth: true },
      { url: `${API_BASE}/api/users/${user?.id || "15"}/profile`, auth: true },
      { url: `${API_BASE}/api/conversations?box=inbox`, auth: true },
      { url: `${API_BASE}/api/stories`, auth: true },
    ];

    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i];
      tests[i].status = "running";
      setResults([...tests]);
      try {
        console.log(`[Debug] Testing: GET ${probe.url}`);
        const res = await fetch(probe.url, {
          headers: probe.auth ? headers : undefined,
          credentials: "omit",
        });
        const data = await res.text();
        console.log(`[Debug]   status: ${res.status}`);
        console.log(`[Debug]   body: ${data.slice(0, 200)}`);
        tests[i].statusCode = res.status;
        tests[i].hasAuth = probe.auth ? !!authToken : false;
        tests[i].responsePreview = data.slice(0, 100);
        tests[i].status = res.status === 200 ? "pass" : "fail";
        if (res.status !== 200) tests[i].error = `Status ${res.status}`;
      } catch (e) {
        tests[i].status = "fail";
        tests[i].error = e instanceof Error ? e.message : String(e);
        console.error(`[Debug] Test ${i + 1} error:`, e);
      }
      setResults([...tests]);
    }

    setRunning(false);
  };

  useEffect(() => {
    runTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native __DEV__ gate → web NODE_ENV gate.
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#06070d] text-white">
        <p className="text-lg">Debug screen is only available in development</p>
        <button onClick={() => router.back()} className="mt-4 p-4 text-[#3FDCFF]">
          Go Back
        </button>
      </div>
    );
  }

  const StatusIcon = ({ status }: { status: TestResult["status"] }) => {
    switch (status) {
      case "pass":
        return <CheckCircle size={20} color="#22c55e" />;
      case "fail":
        return <XCircle size={20} color="#ef4444" />;
      case "running":
        return (
          <span className="inline-block h-5 w-5 rounded-full border-2 border-white/30 border-t-[#3FDCFF] animate-spin" />
        );
      default:
        return <AlertTriangle size={20} color="#71717a" />;
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button onClick={() => router.back()} aria-label="Back" className="active:scale-95">
          <ChevronLeft size={24} color="#fff" />
        </button>
        <h1 className="flex-1 text-lg font-bold">Network Debug</h1>
        <button onClick={runTests} disabled={isRunning} aria-label="Re-run" className="p-2">
          <RefreshCw size={20} color={isRunning ? "#71717a" : "#3FDCFF"} />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* API base info */}
        <div className="mb-4 rounded-lg border border-white/10 bg-white/4 p-4">
          <p className="mb-1 text-sm font-semibold text-white/60">API Base URL</p>
          <p className="font-mono text-sm text-white">{SUPABASE_URL}</p>
          <p className="mt-3 mb-1 text-sm font-semibold text-white/60">Current User</p>
          <p className="font-mono text-sm text-white">
            {user ? `${user.username} (ID: ${user.id})` : "Not logged in"}
          </p>
        </div>

        <p className="mb-2 text-sm font-semibold text-white/60">Test Results</p>
        {results.map((result, index) => (
          <div key={index} className="mb-2 rounded-lg border border-white/10 bg-white/4 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex-1 text-sm font-semibold text-white">{result.name}</p>
              <StatusIcon status={result.status} />
            </div>

            {result.statusCode !== undefined && (
              <p className="mb-1 text-xs text-white/60">
                Status:{" "}
                <span className={result.statusCode === 200 ? "text-green-500" : "text-red-500"}>
                  {result.statusCode}
                </span>
                {" | "}Auth: {result.hasAuth ? "Yes" : "No"}
              </p>
            )}

            {result.error && <p className="mb-1 text-xs text-red-500">Error: {result.error}</p>}

            {result.responsePreview && (
              <p className="line-clamp-2 font-mono text-xs text-white/60">
                {result.responsePreview}
              </p>
            )}
          </div>
        ))}

        {/* Instructions */}
        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="mb-2 text-sm font-semibold text-yellow-500">Debug Instructions</p>
          <p className="whitespace-pre-line text-xs text-yellow-500/80">
            {`1. Check the browser console for [Debug] logs
2. If status shows 401 with hasAuth=false, token is missing
3. If status shows 404, URL path is wrong
4. If Network Error, check URL is reachable
5. Compare with curl results`}
          </p>
        </div>
      </main>
    </div>
  );
}

export default DebugScreen;
