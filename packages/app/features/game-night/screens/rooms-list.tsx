import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { listWatchableRooms, type WatchableRoom } from "../rooms-api";

export default function GameNightRoomsListScreen() {
  const router = useRouter();
  const [rooms, setRooms] = useState<WatchableRoom[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setRooms(await listWatchableRooms()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load tables."); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <View className="flex-1 bg-background px-5 pt-16">
    <Text className="text-3xl font-black text-foreground">Game Night</Text>
    <Text className="mt-1 text-muted-foreground">Join a table or start your own.</Text>
    <View className="my-5 flex-row gap-3">
      <Pressable className="flex-1 items-center rounded-full bg-primary py-4" onPress={() => router.push("/(protected)/game-night/join?create=1" as never)}><Text className="font-bold text-white">Start a table</Text></Pressable>
      <Pressable className="flex-1 items-center rounded-full border border-border py-4" onPress={() => router.push("/(protected)/game-night/join" as never)}><Text className="font-bold text-foreground">Have a code?</Text></Pressable>
    </View>
    {error ? <Text className="mb-3 text-red-500">{error}</Text> : null}
    <FlatList data={rooms} keyExtractor={(r) => r.roomCode} refreshing={refreshing} onRefresh={load}
      ListEmptyComponent={!refreshing ? <Text className="py-12 text-center text-muted-foreground">No open tables yet.</Text> : null}
      renderItem={({item}) => <Pressable className="mb-3 rounded-2xl border border-border bg-secondary p-4" onPress={() => router.push(`/(protected)/game-night/join?code=${item.roomCode}` as never)}>
        <View className="flex-row justify-between"><Text className="text-lg font-bold text-foreground">{item.hostName ?? "A player"}'s table</Text><Text className="font-bold text-primary">{item.status === "playing" ? "Watch" : "Join"}</Text></View>
        <Text className="mt-2 text-muted-foreground">{item.playerCount}/4 players · {item.watcherCount} watching · {item.roomCode}</Text>
      </Pressable>} />
  </View>;
}
