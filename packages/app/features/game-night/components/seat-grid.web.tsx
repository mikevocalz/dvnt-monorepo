"use client";

/**
 * Pre-game: the four seats, the watcher row, and the one action each role
 * gets — ready toggle for seated players, start for the host, take-a-seat
 * for watchers while a chair is free.
 */

import { kickMember, setReady, startMatch, takeSeat } from "../rooms-api";
import { MAX_PLAYERS } from "../seats";
import { Avatar } from "./avatar.web";
import { CommandError, useCommand } from "./use-command";
import type { GameNightState } from "./game-types";

export function SeatGrid({
  state,
  code,
  onChanged,
  hideHostStart = false,
}: {
  state: GameNightState;
  code: string;
  onChanged: () => void;
  /** Post-match: MatchEnd owns the start CTA ("Rematch"), so the host's
      "Start game" button here is suppressed while ready/seat controls stay. */
  hideHostStart?: boolean;
}) {
  const seated = state.members
    .filter((m) => m.role === "player")
    .sort((a, b) => (a.seat_no ?? 99) - (b.seat_no ?? 99));
  const watchers = state.members.filter((m) => m.role === "watcher");

  // Seat numbers are authoritative; the index fallback exists only for
  // malformed states and must never render one member in two seats.
  const claimed = new Set<string>();
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const bySeat = seated.find((m) => m.seat_no === i && !claimed.has(m.user_id));
    if (bySeat) {
      claimed.add(bySeat.user_id);
      return { index: i, member: bySeat };
    }
    const fallback = seated.find((m) => !claimed.has(m.user_id)) ?? null;
    if (fallback) claimed.add(fallback.user_id);
    return { index: i, member: fallback };
  });

  const seatsFree = seated.length < MAX_PLAYERS;
  const nonHostSeated = seated.filter((m) => m.user_id !== state.room.host_id);
  const allReady = nonHostSeated.every((m) => m.ready);
  const enoughPlayers = seated.length >= 2;
  const canStart = enoughPlayers && allReady;
  const startReason = !enoughPlayers
    ? "Need at least 2 seated players"
    : !allReady
      ? "Waiting on everyone to ready up"
      : null;

  const readyCmd = useCommand();
  const startCmd = useCommand();
  const seatCmd = useCommand();
  const kickCmd = useCommand();

  const me = state.me;
  const isWatcher = me.role === "watcher" || !me.member;
  const canKick =
    me.is_host &&
    state.room.status === "open" &&
    !state.match;

  return (
    <section aria-labelledby="seats-heading" className="w-full">
      <h2
        id="seats-heading"
        className="text-sm font-medium uppercase tracking-widest text-white/50"
      >
        The table
      </h2>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {seats.map(({ index, member }) => (
          <li
            key={index}
            className={`rounded-2xl border p-4 text-center ${
              member
                ? "border-white/10 bg-white/4"
                : "border-dashed border-white/15"
            }`}
          >
            {member ? (
              <>
                <div className="mx-auto w-fit">
                  <Avatar name={member.name} src={member.avatar} size="lg" />
                </div>
                <p className="mt-2 truncate text-sm font-medium text-white">
                  {member.name ?? "Someone"}
                  {member.user_id === me.user_id ? (
                    <span className="text-white/40"> (you)</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs">
                  {member.user_id === state.room.host_id ? (
                    <span className="text-[#C9A2F0]">Host</span>
                  ) : member.ready ? (
                    <span className="text-emerald-300">Ready</span>
                  ) : (
                    <span className="text-white/45">Not ready</span>
                  )}
                </p>
                {canKick && member.user_id !== state.room.host_id ? (
                  <button
                    type="button"
                    disabled={kickCmd.pending}
                    aria-label={`Remove ${member.name ?? "player"} from the room`}
                    onClick={() =>
                      kickCmd.run(async () => {
                        await kickMember(code, member.user_id);
                        onChanged();
                      })
                    }
                    className="mt-2 rounded-lg px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:opacity-40"
                  >
                    Remove
                  </button>
                ) : null}
              </>
            ) : (
              <p className="py-6 text-sm text-white/40">Open seat</p>
            )}
          </li>
        ))}
      </ul>

      {watchers.length > 0 ? (
        <p className="mt-3 text-sm text-white/50">
          Watching:{" "}
          {watchers.map((w) => w.name ?? "Someone").join(", ")} (
          {watchers.length})
        </p>
      ) : null}

      <div className="mt-6">
        {isWatcher ? (
          state.room.status === "open" && seatsFree ? (
            <>
              <button
                type="button"
                disabled={seatCmd.pending}
                onClick={() =>
                  seatCmd.run(async () => {
                    await takeSeat(code);
                    onChanged();
                  })
                }
                className="rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7A35BC] disabled:opacity-40"
              >
                {seatCmd.pending ? "Taking a seat…" : "Take a seat"}
              </button>
              <CommandError message={seatCmd.error} />
            </>
          ) : (
            <p className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/60">
              Watching — the table is full.
            </p>
          )
        ) : me.is_host ? (
          <>
            {hideHostStart ? null : (
            <button
              type="button"
              disabled={!canStart || startCmd.pending}
              onClick={() =>
                startCmd.run(async () => {
                  await startMatch(code, crypto.randomUUID());
                  onChanged();
                })
              }
              className="rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7A35BC] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {startCmd.pending ? "Starting…" : "Start game"}
            </button>
            )}
            {startReason ? (
              <p className="mt-2 text-sm text-white/50">{startReason}</p>
            ) : null}
            <CommandError message={startCmd.error} />
            <CommandError message={kickCmd.error} />
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={me.ready}
              disabled={readyCmd.pending}
              onClick={() =>
                readyCmd.run(async () => {
                  await setReady(code, !me.ready);
                  onChanged();
                })
              }
              className={`rounded-xl px-5 py-3 font-semibold transition-colors disabled:opacity-40 ${
                me.ready
                  ? "border border-white/20 bg-white/5 text-white hover:bg-white/10"
                  : "bg-[#8A40CF] text-white hover:bg-[#7A35BC]"
              }`}
            >
              {readyCmd.pending
                ? "Updating…"
                : me.ready
                  ? "Unready"
                  : "Ready up"}
            </button>
            <CommandError message={readyCmd.error} />
          </>
        )}
      </div>
    </section>
  );
}
