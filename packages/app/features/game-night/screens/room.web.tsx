"use client";

/**
 * Game Night — room (WEB).
 *
 * The page has one job: get the second person in. So the code is the largest
 * thing on it — it exists to be read ALOUD across a room, and the share link is
 * the primary action. The roster is feedback, not furniture.
 *
 * Six states, all real: connecting, error, offline, alone, joined, and the
 * no-code fallback. "Nobody has joined" and "we could not reach the room" are
 * different sentences and never share a rendering.
 *
 * Web laws: semantic HTML + Tailwind, no <View>/<Text>. State is Zustand.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useParams } from "solito/navigation";
import { Link } from "solito/link";
import { Gamepad2, Check, Copy, WifiOff, AlertTriangle } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useGameNightStore } from "../store";
import { useRoomPresence } from "../use-room-presence";
import { normalizeRoomCode, isCompleteRoomCode } from "../room-code";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true, // server render assumes online; the client corrects on mount
  );
}

export function GameNightRoomScreen() {
  const params = useParams<{ id?: string | string[] }>();
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const code = raw ? normalizeRoomCode(raw) : "";
  const valid = isCompleteRoomCode(code);

  const user = useAuthStore((s) => s.user);
  const players = useGameNightStore((s) => s.players);
  const status = useGameNightStore((s) => s.status);
  const copied = useGameNightStore((s) => s.copied);
  const setCopied = useGameNightStore((s) => s.setCopied);
  const online = useIsOnline();

  useRoomPresence(
    valid ? code : null,
    user
      ? {
          id: user.id,
          name: user.name || user.username || null,
          avatar: user.avatar ?? null,
          joinedAt: 0,
        }
      : null,
  );

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied, setCopied]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/feed/game-night/room/${code}`,
      );
      setCopied(true);
    } catch {
      // Clipboard can be denied outright. The code is on screen at 72px, so
      // the person still has everything they need — say nothing and let them
      // read it out.
    }
  }, [code, setCopied]);

  if (!valid) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#06070d] px-6 text-center text-white">
        <div className="max-w-sm">
          <h1 className="text-2xl font-semibold">That room code is not valid</h1>
          <p className="mt-2 text-white/60">
            Codes are six characters. Check the one you were given.
          </p>
          <Link
            href="/feed/game-night"
            className="mt-6 inline-block rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white hover:bg-[#7A35BC]"
          >
            Back to Game Night
          </Link>
        </div>
      </main>
    );
  }

  const others = players.filter((p) => p.id !== user?.id);

  return (
    <main className="min-h-dvh bg-[#06070d] px-6 py-12 text-white">
      <div className="mx-auto grid w-full max-w-4xl gap-12 md:grid-cols-[1.1fr_1fr]">
        <section>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/10 px-3 py-1 text-xs font-medium tracking-wide text-[#C9A2F0]">
            <Gamepad2 aria-hidden className="h-3.5 w-3.5" />
            Game Night
          </span>

          <h1 className="mt-6 text-sm font-medium uppercase tracking-widest text-white/50">
            Read this out
          </h1>
          {/* The signature: the code is the largest type on the page, because
              saying it to someone is the only thing that happens here. */}
          <p className="mt-2 font-mono text-6xl font-semibold tracking-[0.18em] text-white sm:text-7xl">
            {code}
          </p>

          <button
            type="button"
            onClick={copyLink}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7A35BC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0]"
          >
            {copied ? (
              <>
                <Check aria-hidden className="h-4 w-4" />
                Link copied
              </>
            ) : (
              <>
                <Copy aria-hidden className="h-4 w-4" />
                Copy join link
              </>
            )}
          </button>
          <p aria-live="polite" className="sr-only">
            {copied ? "Join link copied to clipboard" : ""}
          </p>
        </section>

        <section aria-labelledby="roster-heading">
          <h2
            id="roster-heading"
            className="text-sm font-medium uppercase tracking-widest text-white/50"
          >
            In the room · {players.length}
          </h2>

          {!online ? (
            <Notice
              icon={<WifiOff aria-hidden className="h-4 w-4" />}
              title="You are offline"
              body="The roster will fill in again once you reconnect."
            />
          ) : status === "error" ? (
            <Notice
              icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
              title="Could not reach the room"
              body="This is a connection problem, not an empty room. Reload to try again."
            />
          ) : status === "connecting" || status === "idle" ? (
            <ul className="mt-4 space-y-3" aria-busy="true">
              {[0, 1].map((i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-white/10 p-3"
                >
                  <span className="h-10 w-10 animate-pulse rounded-lg bg-white/10" />
                  <span className="h-3 w-28 animate-pulse rounded bg-white/10" />
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 p-3"
                  >
                    {/* Rounded SQUARE avatars — the repo's rule, never circles. */}
                    {p.avatar ? (
                      <img
                        src={p.avatar}
                        alt=""
                        className="h-10 w-10 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#8A40CF]/25 font-semibold text-[#C9A2F0]">
                        {(p.name ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium">
                      {p.name ?? "Someone"}
                      {p.id === user?.id ? (
                        <span className="text-white/40"> (you)</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>

              {others.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/55">
                  Nobody else yet. Read the code out, or send the link — this
                  list updates the moment they arrive.
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div
      role="status"
      className="mt-4 rounded-xl border border-white/15 bg-white/5 p-4"
    >
      <p className="flex items-center gap-2 font-medium text-white">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-sm text-white/55">{body}</p>
    </div>
  );
}

export default GameNightRoomScreen;
