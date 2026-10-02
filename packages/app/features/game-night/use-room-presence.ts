"use client";

/**
 * Who is in a Game Night room, live.
 *
 * Presence rather than a table on purpose: a roster is true only while people
 * are connected, so storing it means writing rows you then have to expire.
 * Realtime drops you when the socket closes, including the tab-closed case a
 * "leave" write would miss.
 *
 * WHY NOT `freshChannel`
 *
 * It appends a per-client counter to the topic (`prefix:1`, `:2`, …). For
 * `postgres_changes` that is free, because the topic is just a private mailbox
 * for DB events. For PRESENCE the topic IS the room: two clients on
 * `game-night:ABC234:1` and `game-night:ABC234:2` are in two different rooms and
 * will never see each other. Measured — a second client joining the room showed
 * a roster of 1 on both sides until this was changed.
 *
 * So the topic has to be stable, which puts back the hazard freshChannel exists
 * to avoid: `supabase.channel(topic)` RETURNS an already-joined channel when one
 * exists, and `.on()` throws on a joined channel, taking down the subtree. The
 * registry below is the answer — one channel per room for the whole tab,
 * refcounted, so a remount (or StrictMode's double-invoke) attaches to the live
 * channel instead of racing an async removeChannel.
 */

import { useEffect } from "react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useGameNightStore, type RoomPlayer } from "./store";

type Listener = (players: RoomPlayer[], status: "connected" | "error") => void;

interface Entry {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  refs: number;
  /** Deferred removal timer — see release below. */
  closing?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Entry>();

function rosterOf(channel: RealtimeChannel): RoomPlayer[] {
  const state = channel.presenceState<RoomPlayer>();
  // One entry per key, even when a person has two tabs open — the roster
  // answers "who is here", not "how many sockets do they have".
  const byId = new Map<string, RoomPlayer>();
  for (const entries of Object.values(state)) {
    const first = entries[0];
    if (first?.id) byId.set(first.id, first);
  }
  return [...byId.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function acquire(
  topic: string,
  me: RoomPlayer,
  listener: Listener,
): () => boolean {
  let entry = rooms.get(topic);

  // A release defers removeChannel briefly; an immediate remount/StrictMode
  // reacquire cancels it and keeps the already-joined channel.
  if (entry?.closing) {
    clearTimeout(entry.closing);
    entry.closing = undefined;
  }

  if (!entry) {
    const channel = supabase.channel(topic, {
      config: { presence: { key: me.id } },
    });
    entry = { channel, listeners: new Set(), refs: 0 };
    rooms.set(topic, entry);

    const emit = () => {
      const roster = rosterOf(channel);
      for (const l of entry!.listeners) l(roster, "connected");
    };

    channel
      .on("presence", { event: "sync" }, emit)
      .on("presence", { event: "join" }, emit)
      .on("presence", { event: "leave" }, emit)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track(me).then(emit);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Different sentence from "nobody is here" — the screen must never
          // show the calm empty state when the read failed.
          for (const l of entry!.listeners) l([], "error");
        }
      });
  }

  entry.listeners.add(listener);
  entry.refs++;
  // A late subscriber joining a live channel gets the roster immediately
  // rather than sitting on a skeleton until the next sync event.
  if (entry.channel.state === "joined") listener(rosterOf(entry.channel), "connected");

  return () => {
    const e = rooms.get(topic);
    if (!e) return false;
    e.listeners.delete(listener);
    e.refs--;
    if (e.refs > 0) return false;
    // Defer removal: removeChannel is async and a same-topic subscribe while
    // the old channel is still leaving reproduces the joined-channel race this
    // registry exists to prevent.
    e.closing = setTimeout(() => {
      if (rooms.get(topic) === e && e.refs <= 0) {
        rooms.delete(topic);
        void supabase.removeChannel(e.channel);
      }
    }, 250);
    return true;
  };
}

export function useRoomPresence(code: string | null, me: RoomPlayer | null): void {
  const setPlayers = useGameNightStore((s) => s.setPlayers);
  const setStatus = useGameNightStore((s) => s.setStatus);

  const myId = me?.id ?? null;
  const myName = me?.name ?? null;
  const myAvatar = me?.avatar ?? null;

  useEffect(() => {
    if (!code || !myId) return;
    setStatus("connecting");

    const release = acquire(
      `game-night:${code}`,
      { id: myId, name: myName, avatar: myAvatar, joinedAt: Date.now() },
      (players, status) => {
        setPlayers(players);
        setStatus(status);
      },
    );

    return () => {
      // Only the final release owns the shared roster — an earlier consumer
      // unmounting must not blank the list for whoever is still subscribed.
      if (release()) {
        setPlayers([]);
        setStatus("idle");
      }
    };
  }, [code, myId, myName, myAvatar, setPlayers, setStatus]);
}
