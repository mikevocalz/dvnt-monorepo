/**
 * Game Night leaderboard — universal (RNW on web, native on device).
 * Top 10 + the caller's own standing, per mode.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar } from "../../../components/ui/avatar";
import { fetchLeaderboard, type Leaderboard } from "../rooms-api";

function rankClasses(rank: number) {
  if (rank === 1) {
    return {
      row: "border-[#D9A419]/35 bg-[#D9A419]/10",
      badge: "bg-[#D9A419] text-[#171008]",
      points: "text-[#FFD865]",
    };
  }
  if (rank === 2) {
    return {
      row: "border-white/15 bg-white/8",
      badge: "bg-white/80 text-[#17121d]",
      points: "text-white",
    };
  }
  if (rank === 3) {
    return {
      row: "border-[#B77855]/30 bg-[#B77855]/10",
      badge: "bg-[#B77855] text-white",
      points: "text-[#E8B18E]",
    };
  }
  return {
    row: "border-white/7 bg-black/15",
    badge: "bg-white/8 text-white/55",
    points: "text-[#C9A2F0]",
  };
}

export function GameNightLeaderboard({
  mode = "classic",
}: {
  mode?: "classic" | "duel";
}) {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLeaderboard(mode)
      .then((nextBoard) => {
        if (live) setBoard(nextBoard);
      })
      .catch((e) => {
        if (live) {
          setError(e instanceof Error ? e.message : "Couldn't load standings.");
        }
      });
    return () => {
      live = false;
    };
  }, [mode]);

  if (error) {
    return <Text className="text-sm text-red-400">{error}</Text>;
  }
  if (!board) {
    return <Text className="text-sm text-white/40">Loading standings…</Text>;
  }
  if (board.top10.length === 0) {
    return (
      <View className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <Text className="text-sm font-semibold text-white/50">
          No finished matches yet — win one and this is yours.
        </Text>
      </View>
    );
  }

  const mine = board.me;
  const mineInTop =
    mine && board.top10.some((entry) => entry.user_id === mine.user_id);

  return (
    <View
      accessibilityLabel="Leaderboard"
      className="overflow-hidden rounded-3xl border border-white/10 bg-[#0D0D14] p-3"
    >
      <View className="mb-2 flex-row items-end justify-between px-2 pt-1">
        <View>
          <Text className="text-[10px] font-black uppercase tracking-[2px] text-[#C9A2F0]">
            DVNT Game Night
          </Text>
          <Text className="mt-1 text-lg font-black text-white">
            Top players
          </Text>
        </View>
        <View className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
          <Text className="text-[10px] font-bold uppercase tracking-[1px] text-white/45">
            {mode === "duel" ? "Duel" : "Classic"}
          </Text>
        </View>
      </View>

      <View className="gap-2">
        {board.top10.map((entry) => {
          const tone = rankClasses(entry.rank);
          const isMe = entry.user_id === mine?.user_id;
          return (
            <View
              key={entry.user_id}
              accessibilityLabel={`Rank ${entry.rank}, ${entry.name ?? "Player"}, ${entry.wins} wins, ${entry.points} points`}
              className={`flex-row items-center gap-3 rounded-2xl border px-3 py-3 ${tone.row} ${
                isMe ? "border-[#8A40CF]/70" : ""
              }`}
            >
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${tone.badge}`}
              >
                <Text className="font-mono text-xs font-black tabular-nums">
                  {entry.rank}
                </Text>
              </View>

              <Avatar
                uri={entry.avatar}
                username={entry.name ?? "Player"}
                size="sm"
              />

              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text
                    numberOfLines={1}
                    className="min-w-0 shrink text-sm font-black text-white"
                  >
                    {entry.name ?? "Player"}
                  </Text>
                  {isMe ? (
                    <Text className="text-[10px] font-black uppercase tracking-[1px] text-[#C9A2F0]">
                      you
                    </Text>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-[11px] font-semibold text-white/42">
                  {entry.wins} {entry.wins === 1 ? "win" : "wins"} · {entry.matches}{" "}
                  {entry.matches === 1 ? "game" : "games"}
                </Text>
              </View>

              <View className="items-end">
                <Text className={`font-mono text-lg font-black tabular-nums ${tone.points}`}>
                  {entry.points}
                </Text>
                <Text className="text-[9px] font-bold uppercase tracking-[1px] text-white/30">
                  pts
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {mine && !mineInTop ? (
        <View className="mt-3 rounded-2xl border border-[#8A40CF]/35 bg-[#8A40CF]/10 p-3">
          <Text className="text-sm font-semibold text-white/70">
            You’re #{mine.rank} · {mine.wins}W · {mine.points} pts across{" "}
            {mine.matches} {mine.matches === 1 ? "match" : "matches"}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
