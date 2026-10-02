import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useGameNightState } from "../use-game-state";
import { useRoomPresence } from "../use-room-presence";
import { duelPick, endRoom, fetchRoomMessages, judgePick, leaveRoom, sendRoomMessage, setReady, startMatch, submitCards, takeSeat, type GameNightMessage } from "../rooms-api";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { supabase } from "@dvnt/app/lib/supabase/client";

const Button = ({label, onPress, disabled = false}:{label:string;onPress:()=>void;disabled?:boolean}) => <Pressable disabled={disabled} onPress={onPress} className={`items-center rounded-full px-5 py-3 ${disabled ? "bg-secondary" : "bg-primary"}`}><Text className="font-bold text-white">{label}</Text></Pressable>;

export default function GameNightRoomScreen() {
  const { code: raw } = useLocalSearchParams<{code:string}>();
  const code = String(raw ?? "").toUpperCase();
  const router = useRouter();
  const { state, status, error, refresh } = useGameNightState(code);
  const [selected, setSelected] = useState<string[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GameNightMessage[]>([]);
  const [draft, setDraft] = useState("");
  const snapPoints = useMemo(() => [120, "60%"], []);
  useRoomPresence(code, state ? { id: state.me.user_id, name: state.members.find(m => m.user_id === state.me.user_id)?.name ?? null, avatar: state.members.find(m => m.user_id === state.me.user_id)?.avatar ?? null, joinedAt: Date.now() } : null);
  const busy = useRef(false);
  const loadMessages = useCallback(async () => { if (state) setMessages(await fetchRoomMessages(state.room.id)); }, [state?.room.id]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Live chat on native too — without a subscription the sheet only refreshes
  // when the local user sends.
  const roomId = state?.room.id ?? null;
  useEffect(() => {
    if (!roomId) return;
    const channel = freshChannel(`game-night-chat-native:${roomId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "game_night_messages",
        filter: `room_id=eq.${roomId}`,
      }, () => void loadMessages())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, loadMessages]);

  // Selection is per-round; stale card ids must not carry into the next deal.
  const roundId = state?.round?.id ?? null;
  useEffect(() => { setSelected([]); }, [roundId]);

  const act = async (fn:()=>Promise<unknown>) => {
    if (busy.current) return; // synchronous lock — a double tap is one command
    busy.current = true;
    setCommandError(null);
    try { await fn(); await refresh(); } catch (e) { setCommandError(e instanceof Error ? e.message : "Command failed."); } finally { busy.current = false; }
  };
  const leave = () => void act(async () => { await leaveRoom(code); router.replace("/(protected)/game-night" as never); });
  const send = () => void act(async () => { const body = draft.trim(); if (!body) return; await sendRoomMessage(code, "text", {body}); setDraft(""); await loadMessages(); });

  if (status === "loading" || status === "idle") return <View className="flex-1 items-center justify-center bg-background"><Text className="text-foreground">Setting the table…</Text></View>;
  if (!state || status === "not_found" || status === "error") return <View className="flex-1 items-center justify-center bg-background px-8"><Text className="text-center text-foreground">{error ?? "This room doesn't exist or has ended."}</Text><View className="mt-5"><Button label="Back to tables" onPress={() => router.replace("/(protected)/game-night" as never)} /></View></View>;

  const { me, round, match, members } = state;
  const isJudge = round?.judge_user_id === me.user_id;
  const pick = round?.prompt?.pick ?? 1;
  const seats = [0,1,2,3].map(n => members.find(m => m.seat_no === n));
  const scoreName = (id:string) => members.find(m => m.user_id === id)?.name ?? "Player";
  return <View className="flex-1 bg-background pt-12">
    <View className="flex-row items-center justify-between px-5 pb-3"><View><Text className="text-2xl font-black text-foreground">Game Night</Text><Text className="text-muted-foreground">Room {code} · {me.role === "watcher" ? "Watching" : `Seat ${(me.seat_no ?? 0) + 1}`}</Text></View><Pressable onPress={leave}><Text className="font-bold text-red-500">Leave</Text></Pressable></View>
    <ScrollView className="flex-1 px-5" contentContainerStyle={{paddingBottom:150}}>
      {commandError ? <Text className="mb-3 text-red-500">{commandError}</Text> : null}
      <View className="flex-row flex-wrap justify-between">{seats.map((member, i) => <View key={i} className="mb-3 w-[48%] rounded-2xl border border-border bg-secondary p-4"><Text className="font-bold text-foreground">{member?.name ?? `Open seat ${i+1}`}</Text><Text className={member?.ready ? "text-green-500" : "text-muted-foreground"}>{member ? (member.ready ? "Ready" : "Not ready") : "Available"}</Text>{me.is_host && member && member.user_id !== me.user_id && !match ? <Pressable onPress={() => void act(() => import("../rooms-api").then(x => x.kickMember(code, member.user_id)))}><Text className="mt-2 text-xs text-red-500">Remove</Text></Pressable> : null}</View>)}</View>
      {!match && me.role === "watcher" ? <View className="mb-4"><Button label="Take an open seat" onPress={() => void act(() => takeSeat(code))} /></View> : null}
      {!match && me.role === "player" ? <View className="mb-4"><Button label={me.ready ? "I'm not ready" : "I'm ready"} onPress={() => void act(() => setReady(code, !me.ready))} /></View> : null}
      {!match && me.is_host ? <Button label="Start match" onPress={() => void act(() => startMatch(code, randomUUID()))} /> : null}
      {match ? <View className="my-4 rounded-2xl bg-secondary p-4"><Text className="text-lg font-black text-foreground">Scores</Text>{Object.entries(match.scores).map(([id, score]) => <Text key={id} className="mt-1 text-foreground">{scoreName(id)}: {score}</Text>)}</View> : null}
      {round?.prompt ? <View className="mb-4 rounded-2xl bg-primary p-5"><Text className="text-xs font-bold text-white">ROUND {round.round_no} · PICK {pick}</Text><Text className="mt-2 text-xl font-black text-white">{round.prompt.text}</Text></View> : null}
      {round?.phase === "submitting" && me.role === "player" && !isJudge ? <><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">{me.hand.map(card => { const on = selected.includes(card.card_id); return <Pressable key={card.card_id} onPress={() => setSelected(s => on ? s.filter(x => x !== card.card_id) : s.length < pick ? [...s, card.card_id] : s)} className={`mr-3 w-44 rounded-2xl border p-4 ${on ? "border-primary bg-primary" : "border-border bg-secondary"}`}><Text className="font-bold text-foreground">{card.text}</Text></Pressable>; })}</ScrollView><Button label="Play cards" disabled={selected.length !== pick} onPress={() => void act(async () => { await submitCards(code, selected, randomUUID()); setSelected([]); })} /></> : null}
      {round?.phase === "judging" ? <View>{round.reveal.map(r => <Pressable disabled={!isJudge} key={r.submission_id} onPress={() => void act(() => judgePick(code, r.submission_id, randomUUID()))} className="mb-3 rounded-2xl border border-border bg-secondary p-4"><Text className="font-bold text-foreground">{r.texts.join(" / ")}</Text>{isJudge ? <Text className="mt-2 text-primary">Pick winner</Text> : null}</Pressable>)}</View> : null}
      {round?.phase === "duel_lock" && round.duel_options ? <View className="flex-row flex-wrap justify-between">{round.duel_options.map(o => <Pressable key={o.card_id} onPress={() => void act(() => duelPick(code, o.card_id, randomUUID()))} className="mb-3 w-[48%] rounded-2xl bg-secondary p-4"><Text className="font-bold text-foreground">{o.text}</Text></Pressable>)}</View> : null}
      {round && ["round_results","duel_results"].includes(round.phase) ? <Text className="py-5 text-center text-xl font-black text-foreground">{round.winner_user_id ? `${scoreName(round.winner_user_id)} wins the round` : "Round complete"}</Text> : null}
      {match?.status === "completed" ? <View className="items-center gap-3 py-6"><Text className="text-2xl font-black text-foreground">{match.winner_user_id ? `${scoreName(match.winner_user_id)} wins!` : "Match complete"}</Text>{me.is_host ? <><Button label="Rematch" onPress={() => void act(() => startMatch(code, randomUUID()))} /><Button label="End room" onPress={() => void act(() => endRoom(code))} /></> : null}</View> : null}
      {me.role === "watcher" ? <Text className="py-3 text-center text-muted-foreground">Watcher mode is read-only.</Text> : null}
    </ScrollView>
    <BottomSheet index={0} snapPoints={snapPoints} backgroundStyle={{backgroundColor:"#171717"}} handleIndicatorStyle={{backgroundColor:"#737373"}}><BottomSheetView style={{flex:1,paddingHorizontal:16}}><Text className="mb-2 text-base font-black text-white">Table chat</Text><FlatList style={{flex:1}} data={[...messages].reverse()} keyExtractor={m => String(m.id)} renderItem={({item}) => <Text className="mb-2 text-white">{scoreName(item.userId)}: {item.body ?? item.reaction ?? "Shared something"}</Text>} /><View className="flex-row gap-2 pb-5"><TextInput value={draft} onChangeText={setDraft} placeholder="Message the table" placeholderTextColor="#737373" className="flex-1 rounded-full bg-black px-4 py-3 text-white" /><Pressable onPress={send} className="justify-center rounded-full bg-primary px-5"><Text className="font-bold text-white">Send</Text></Pressable></View></BottomSheetView></BottomSheet>
  </View>;
}
