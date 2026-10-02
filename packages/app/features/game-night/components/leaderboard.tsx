/**
 * Game Night leaderboard — universal (RNW on web, native on device).
 * Top 10 + the caller's own standing, per mode.
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
      .then((b) => {
        if (live) setBoard(b);
      })
      .catch((e) => {
        if (live)
          setError(e instanceof Error ? e.message : "Couldn't load standings.");
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
      <View className="rounded-xl border border-white/10 bg-white/5 p-4">
        <Text className="text-sm text-white/50">
          No finished matches yet — win one and this is yours.
        </Text>
      </View>
    );
  }

  const mine = board.me;
  const mineInTop =
    mine && board.top10.some((e) => e.user_id === mine.user_id);

  return (
    <View accessibilityLabel="Leaderboard">
      {board.top10.map((e, i) => (
        <View
          key={e.user_id}
          className={`flex-row items-center gap-3 border-b border-white/5 py-2.5 ${
            e.user_id === mine?.user_id
              ? "-mx-3 rounded-lg bg-[#8A40CF]/10 px-3"
              : ""
          } ${i === board.top10.length - 1 ? "border-b-0" : ""}`}
        >
          <Text
            className={`w-7 text-center font-mono text-sm tabular-nums ${
              e.rank === 1 ? "text-[#FFB21D]" : "text-white/40"
            }`}
          >
            {e.rank}
          </Text>
          <Avatar uri={e.avatar} username={e.name ?? "Player"} size="sm" />
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="text-sm font-medium text-white"
            >
              {e.name ?? "Player"}
            </Text>
            {e.user_id === mine?.user_id ? (
              <Text className="text-xs text-[#C9A2F0]">you</Text>
            ) : null}
          </View>
          <Text className="font-mono text-sm tabular-nums text-white/70">
            {e.wins}W
          </Text>
          <Text className="w-10 text-right font-mono text-sm tabular-nums text-[#C9A2F0]">
            {e.points}
          </Text>
        </View>
      ))}
      {mine && !mineInTop ? (
        <Text className="mt-3 text-sm text-white/50">
          You're #{mine.rank} — {mine.wins}W, {mine.points} pts across{" "}
          {mine.matches} {mine.matches === 1 ? "match" : "matches"}.
        </Text>
      ) : null}
    </View>
  );
}
