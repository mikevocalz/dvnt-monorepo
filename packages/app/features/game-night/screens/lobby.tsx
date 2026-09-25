import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { createRoom, joinRoom } from "../rooms-api";

export default function GameNightLobbyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; create?: string }>();
  const [code, setCode] = useState((params.code ?? "").toUpperCase().slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => { setBusy(true); setError(null); try { const room = await createRoom(randomUUID()); router.replace(`/(protected)/game-night/room/${room.roomCode}` as never); } catch (e) { setError(e instanceof Error ? e.message : "Could not start a table."); } finally { setBusy(false); } };
  const join = async () => { if (code.length !== 6) return; setBusy(true); setError(null); try { const room = await joinRoom(code); router.replace(`/(protected)/game-night/room/${room.roomCode}` as never); } catch (e) { setError(e instanceof Error ? e.message : "That room could not be found."); } finally { setBusy(false); } };
  useEffect(() => { if (params.create === "1") void create(); }, []);
  return <View className="flex-1 bg-background px-6 pt-20">
    <Text className="text-3xl font-black text-foreground">Pull up a chair</Text>
    <Text className="mt-2 text-muted-foreground">Start a new table, or enter the six-character invite code.</Text>
    <Pressable disabled={busy} onPress={create} className="mt-8 items-center rounded-full bg-primary py-4"><Text className="font-bold text-white">{busy && params.create === "1" ? "Starting…" : "Start a table"}</Text></Pressable>
    <Text className="my-6 text-center text-muted-foreground">or</Text>
    <TextInput value={code} onChangeText={(v) => { setCode(v.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6)); setError(null); }} maxLength={6} autoCapitalize="characters" autoCorrect={false} placeholder="ABC123" placeholderTextColor="#6B7280" className="rounded-2xl border border-border bg-secondary px-4 py-5 text-center text-2xl font-black tracking-widest text-foreground" />
    {error ? <Text className="mt-3 text-center text-red-500">{error}</Text> : null}
    <Pressable disabled={busy || code.length !== 6} onPress={join} className={`mt-4 items-center rounded-full py-4 ${code.length === 6 ? "bg-primary" : "bg-secondary"}`}><Text className="font-bold text-white">{busy ? "Joining…" : "Join table"}</Text></Pressable>
  </View>;
}
