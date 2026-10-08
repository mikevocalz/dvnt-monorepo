import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetFlatList,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useGameNightState } from "../use-game-state";
import { useRoomPresence } from "../use-room-presence";
import { duelPick, endRoom, fetchRoomMessages, judgePick, leaveRoom, sendRoomMessage, setReady, startMatch, submitCards, takeSeat, type GameNightMessage } from "../rooms-api";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { RoomReactionDock } from "../components/room-reaction-dock.native";
import { RoomReactionOverlay } from "../components/room-reaction-overlay.native";
import {
  createRoomReactionEvent,
  emitRoomReaction,
  isRoomReactionEmoji,
} from "../motion/room-reactions";
import { classicWinText, duelFormatText, GAME_NIGHT_DECK_FACTS } from "../game-rules";

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
  const [rulesOpen, setRulesOpen] = useState(false);
  const chatSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["75%"], []);
  useRoomPresence(code, state ? { id: state.me.user_id, name: state.members.find(m => m.user_id === state.me.user_id)?.name ?? null, avatar: state.members.find(m => m.user_id === state.me.user_id)?.avatar ?? null, joinedAt: Date.now() } : null);
  const busy = useRef(false);
  const loadMessages = useCallback(async () => { if (state) setMessages(await fetchRoomMessages(state.room.id)); }, [state?.room.id]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Live chat on native too — without a subscription the sheet only refreshes
  // when the local user sends.
  const roomId = state?.room.id ?? null;
  const myUserId = state?.me.user_id ?? null;
  useEffect(() => {
    if (!roomId) return;
    const channel = freshChannel(`game-night-chat-native:${roomId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "game_night_messages",
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const row = payload.new as {
          id?: number;
          user_id?: string;
          kind?: string;
          reaction?: string | null;
          created_at?: string;
        };
        if (
          row.kind === "reaction" &&
          row.reaction &&
          row.user_id &&
          row.user_id !== myUserId &&
          isRoomReactionEmoji(row.reaction)
        ) {
          emitRoomReaction(
            createRoomReactionEvent({
              id: `remote-native-${row.id ?? Date.now()}`,
              roomId,
              userId: row.user_id,
              emoji: row.reaction,
              isMine: false,
              seatIndex:
                state?.members.find((member) => member.user_id === row.user_id)
                  ?.seat_no ?? -1,
              createdAt: row.created_at
                ? Date.parse(row.created_at) || Date.now()
                : Date.now(),
            }),
          );
        }
        void loadMessages();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, myUserId, state?.members, loadMessages]);

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
    <RoomReactionOverlay roomId={state.room.id} />
    <View className="flex-row items-center justify-between px-5 pb-3"><View><Text className="text-2xl font-black text-foreground">Game Night</Text><Text className="text-muted-foreground">Room {code} · {me.role === "watcher" ? "Watching" : `Seat ${(me.seat_no ?? 0) + 1}`}</Text></View><View className="flex-row items-center gap-4"><Pressable onPress={() => setRulesOpen((open) => !open)}><Text className="font-bold text-primary">{rulesOpen ? "Hide rules" : "How to play"}</Text></Pressable><Pressable onPress={leave}><Text className="font-bold text-red-500">Leave</Text></Pressable></View></View>
    <View className="items-end px-5 pb-3">
      <RoomReactionDock
        code={code}
        roomId={state.room.id}
        userId={me.user_id}
        seatIndex={me.seat_no}
      />
    </View>
    <ScrollView className="flex-1 px-5" contentContainerStyle={{paddingBottom:150}}>
      {commandError ? <Text className="mb-3 text-red-500">{commandError}</Text> : null}
      {rulesOpen ? <View className="mb-5 rounded-2xl border border-border bg-secondary p-4">
        <Text className="text-base font-black text-foreground">How this table works</Text>
        <Text className="mt-2 text-sm leading-5 text-muted-foreground">2 seated players = Duel. 3–4 seated players = Classic. The host starts once everyone else is ready. More than 4 people join as watchers.</Text>
        <Text className="mt-4 text-xs font-black uppercase tracking-widest text-primary">Classic · 3–4 players</Text>
        <Text className="mt-2 text-sm leading-5 text-muted-foreground">You hold 7 answer cards. A rotating judge sits out each round. Everyone else plays the 1 or 2 cards the prompt asks for within 45 seconds. The judge gets 60 seconds to pick a favorite; that player scores 1 point. {classicWinText(match?.target_score ?? 5)}</Text>
        <Text className="mt-4 text-xs font-black uppercase tracking-widest text-primary">Duel · exactly 2 players</Text>
        <Text className="mt-2 text-sm leading-5 text-muted-foreground">One player is the subject and secretly chooses a favorite from 6 shared options. The other predicts that choice. A correct prediction scores 1 point; a miss scores 0. {duelFormatText(match?.duel_paired_rounds ?? 5)}</Text>
        <Text className="mt-4 text-xs font-black uppercase tracking-widest text-primary">Cards</Text>
        <Text className="mt-2 text-sm leading-5 text-muted-foreground">Visual theme: {GAME_NIGHT_DECK_FACTS.visualTheme}. Playable text: DVNT's {GAME_NIGHT_DECK_FACTS.promptCount}-prompt / {GAME_NIGHT_DECK_FACTS.answerCount}-answer nightlife deck.</Text>
      </View> : null}
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

    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open table chat"
      onPress={() => chatSheetRef.current?.snapToIndex(0)}
      className="absolute bottom-28 right-5 z-20 flex-row items-center rounded-full border border-primary/40 bg-neutral-950 px-5 py-3 shadow-lg"
    >
      <Text className="font-black text-white">Chat</Text>
    </Pressable>

    <BottomSheet
      ref={chatSheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: "#171717" }}
      handleIndicatorStyle={{ backgroundColor: "#737373" }}
    >
      <BottomSheetView style={{ flex: 1, paddingHorizontal: 16 }}>
        <Text className="mb-3 text-base font-black text-white">Table chat</Text>
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={[...messages].reverse()}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ paddingBottom: 12 }}
          renderItem={({ item }) => (
            <Text className="mb-2 text-white">
              {scoreName(item.userId)}:{" "}
              {item.body ?? item.reaction ?? "Shared something"}
            </Text>
          )}
        />
        <View className="flex-row gap-2 pb-5 pt-2">
          <BottomSheetTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the table"
            placeholderTextColor="#737373"
            style={{
              flex: 1,
              borderRadius: 999,
              backgroundColor: "#000",
              color: "#fff",
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          />
          <Pressable
            onPress={send}
            className="justify-center rounded-full bg-primary px-5"
          >
            <Text className="font-bold text-white">Send</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  </View>;
}
