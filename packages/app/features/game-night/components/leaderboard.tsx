/**
 * Game Night leaderboard — universal (RNW on web, native on device).
 * Top 10 + caller standing. Visual treatment mirrors the game HUD while
 * remaining a regular RN tree until the authored Rive asset lands.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar } from "../../../components/ui/avatar";
import { fetchLeaderboard, type Leaderboard } from "../rooms-api";

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
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch((cause) => {
        if (live) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn't load standings.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, [mode]);

  if (error) {
    return (
      <View className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4">
        <Text className="text-sm font-semibold text-red-300">{error}</Text>
      </View>
    );
  }

  if (!board) {
    return (
      <View className="gap-2">
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            className="h-14 rounded-2xl border border-white/5 bg-white/5"
          />
        ))}
      </View>
    );
  }

  if (board.top10.length === 0) {
    return (
      <View className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <Text className="text-sm font-semibold text-white/55">
          No finished matches yet — win one and this is yours.
        </Text>
      </View>
    );
  }

  const mine = board.me;
  const mineInTop =
    mine && board.top10.some((entry) => entry.user_id === mine.user_id);

  return (
    <View accessibilityLabel="Leaderboard" className="gap-2">
      {board.top10.map((entry) => {
        const isMine = entry.user_id === mine?.user_id;
        const isLeader = entry.rank === 1;
        return (
          <View
            key={entry.user_id}
            className={`flex-row items-center gap-3 rounded-2xl border px-3 py-3 ${
              isMine
                ? "border-[#8A40CF]/50 bg-[#8A40CF]/12"
                : isLeader
                  ? "border-[#D9A419]/30 bg-[#D9A419]/7"
                  : "border-white/7 bg-white/3"
            }`}
          >
            <View
              className={`h-8 w-8 items-center justify-center rounded-xl ${
                isLeader ? "bg-[#D9A419]" : "bg-white/7"
              }`}
            >
              <Text
                className={`font-mono text-xs font-black tabular-nums ${
                  isLeader ? "text-[#171008]" : "text-white/55"
                }`}
              >
                {entry.rank}
              </Text>
            </View>

            <Avatar
              uri={entry.avatar}
              username={entry.name ?? "Player"}
              size="sm"
            />

            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 text-sm font-bold text-white"
                >
                  {entry.name ?? "Player"}
                </Text>
                {isMine ? (
                  <Text className="text-[10px] font-bold uppercase tracking-wider text-[#C9A2F0]">
                    you
                  </Text>
                ) : null}
              </View>
              <Text className="mt-0.5 text-[11px] font-medium text-white/40">
                {entry.matches} {entry.matches === 1 ? "match" : "matches"}
              </Text>
            </View>

            <View className="items-end">
              <Text className="font-mono text-sm font-black tabular-nums text-white">
                {entry.points}
              </Text>
              <Text className="text-[9px] font-bold uppercase tracking-widest text-white/35">
                pts
              </Text>
            </View>

            <View className="items-end">
              <Text
                className={`font-mono text-sm font-black tabular-nums ${
                  isLeader ? "text-[#FFD865]" : "text-[#C9A2F0]"
                }`}
              >
                {entry.wins}W
              </Text>
              <Text className="text-[9px] font-bold uppercase tracking-widest text-white/35">
                wins
              </Text>
            </View>
          </View>
        );
      })}

      {mine && !mineInTop ? (
        <View className="mt-2 rounded-2xl border border-[#8A40CF]/40 bg-[#8A40CF]/10 p-4">
          <Text className="text-sm font-bold text-white">
            You're #{mine.rank}
          </Text>
          <Text className="mt-1 text-xs font-medium text-white/50">
            {mine.wins}W · {mine.points} pts across {mine.matches}{" "}
            {mine.matches === 1 ? "match" : "matches"}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
