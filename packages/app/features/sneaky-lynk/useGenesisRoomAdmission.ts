import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { videoApi } from "@dvnt/app/features/video/api";
import type { JoinRoomResponse } from "@dvnt/app/features/video/types";
import { useRoomLifecycle } from "@dvnt/app/features/video/useRoomLifecycle";
import { sneakyLynkApi } from "./api/supabase";
import { useRoomHeartbeat } from "./hooks/useRoomHeartbeat";
import { useEventLynkWaitingRoom } from "./hooks/useEventLynkWaitingRoom";
import { leaveRoomSafely } from "./session/leave-room";
import { classifySneakyLynkError } from "./errors";

type Phase = "joining" | "admitted" | "waiting" | "error" | "ended" | "suspended";
interface Admission {
  scope: string;
  /** Forces new capture opt-in even if pause/resume renders were batched. */
  generation?: number;
  phase: Phase;
  data: JoinRoomResponse | null;
  message: string | null;
}

const accountOwner = () => {
  const user = useAuthStore.getState().user;
  return user?.authId || user?.id || "";
};
const isForeground = () =>
  AppState.currentState !== "background" &&
  AppState.currentState !== "inactive" &&
  (typeof document === "undefined" || document.visibilityState !== "hidden");

/** The legacy broadcast UI uses the SAME admission and lifecycle as room UI.
 * A query parameter is a display preference, never permission to mint media.
 * The caller mounts transport only while `admitted` is true.
 */
export function useGenesisRoomAdmission(roomId: string, onExit: () => void) {
  const owner = useAuthStore((s) => s.user?.authId || s.user?.id || "");
  const [accountEpoch, setAccountEpoch] = useState(0);
  const scope = JSON.stringify([roomId, owner, accountEpoch]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const lifetime = useRef({ active: false, epoch: 0 });
  const terminalRef = useRef(false);
  const request = useRef(0);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [foreground, setForeground] = useState(isForeground);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [state, setState] = useState<Admission>({ scope, phase: "joining", data: null, message: null });
  const suspendedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const finish = useCallback((message = "This Lynk has ended") => {
    terminalRef.current = true;
    ++request.current;
    suspendedRef.current = false;
    leavingRef.current = false;
    setLeaving(false);
    setState({ scope, phase: "ended", data: null, message });
  }, [scope]);

  const join = useCallback(async () => {
    if (!roomId || !owner || !lifetime.current.active || terminalRef.current || !isForeground() ||
      scopeRef.current !== scope || accountOwner() !== owner) return;
    const epoch = lifetime.current.epoch;
    const attempt = ++request.current;
    const current = () => lifetime.current.active && lifetime.current.epoch === epoch &&
      scopeRef.current === scope && request.current === attempt && accountOwner() === owner;
    setState({ scope, phase: "joining", data: null, message: null });
    try {
      const result = await videoApi.joinRoom(roomId);
      if (!current()) return;
      if (!result.ok || !result.data) {
        const error = classifySneakyLynkError(result.error?.code, result.error?.message, result.error?.detail);
        setState({ scope, phase: error.reason === "waiting_for_host" ? "waiting" : "error", data: null,
          message: error.reason === "room_full" ? "This room is full. Try again when a seat opens up." : `${error.title}. ${error.body}` });
        return;
      }
      // Better Auth owns the user identity; never accept another account's reply.
      if (result.data.user.id !== owner) {
        setState({ scope, phase: "error", data: null, message: "Your account changed. Please rejoin." });
        return;
      }
      setState({ scope, generation: attempt, phase: "admitted", data: result.data, message: null });
    } catch {
      if (current()) setState({ scope, phase: "error", data: null, message: "Couldn't join this Lynk. Please try again." });
    }
  }, [roomId, owner, scope]);

  useEffect(() => {
    lifetime.current = { active: true, epoch: lifetime.current.epoch + 1 };
    terminalRef.current = false;
    suspendedRef.current = !isForeground();
    leavingRef.current = false;
    setLeaving(false);
    if (!owner) setState({ scope, phase: "error", data: null, message: "Sign in to join this Lynk." });
    else if (isForeground()) void join();
    else setState({ scope, phase: "suspended", data: null, message: "Return to the app to rejoin." });
    // Invalidate even A → B → A changes batched before the next React render.
    const unsubscribe = useAuthStore.subscribe(() => {
      if (accountOwner() !== owner) {
        ++request.current;
        setAccountEpoch((value) => value + 1);
      }
    });
    return () => {
      unsubscribe();
      lifetime.current = { active: false, epoch: lifetime.current.epoch + 1 };
      ++request.current;
      // Navigation/effect replay stops local media through stage unmount.
      // video_leave_room has no session generation: a delayed cleanup call
      // could revoke a newer admission (or end its room). Only explicit Leave
      // mutates membership; abandoned seats use the existing server cleanup.
    };
  }, [join, owner, roomId, scope]);

  useEffect(() => {
    const onChange = () => {
      const active = isForeground();
      setForeground(active);
      if (!active) {
        if (terminalRef.current || stateRef.current.phase === "ended" || stateRef.current.phase === "error") return;
        suspendedRef.current = true;
        ++request.current;
        setState((previous) => previous.scope === scope && previous.phase !== "ended" && previous.phase !== "error"
          ? { ...previous, phase: "suspended" } : previous);
      } else {
        // Rejoin, rather than resuming stale authority after a missed room end.
        // The new stage starts with camera/mic opt-in cleared.
        if (suspendedRef.current) {
          suspendedRef.current = false;
          void join();
        }
      }
    };
    const subscription = AppState.addEventListener("change", onChange);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onChange);
    return () => {
      subscription.remove();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onChange);
    };
  }, [join, scope]);

  const current = state.scope === scope;
  const admitted = current && state.phase === "admitted" && foreground && !!owner;
  const data = current ? state.data : null;

  useRoomHeartbeat(roomId, admitted);
  const { notifyEnded } = useRoomLifecycle({
    roomId, userId: data?.user.id, enabled: current && !!data,
    onEnded: finish, connectionStatus,
  });
  useEventLynkWaitingRoom({
    roomId, enabled: current && state.phase === "waiting" && foreground,
    onAdmitted: () => { void join(); },
    onRefused: (message) => setState({ scope, phase: "error", data: null, message }),
  });

  useEffect(() => {
    if (!admitted || !data) return;
    let active = true;
    const valid = () => active && !terminalRef.current && scopeRef.current === scope && accountOwner() === owner;
    const stopEvents = videoApi.subscribeToRoomEvents(roomId, data.user.id, (event) => {
      if (!valid()) return;
      if (event.type === "room_ended") notifyEnded();
      else if (["eject", "member_kicked", "member_banned"].includes(event.type) && event.targetId === data.user.id) {
        finish("You were removed from this Lynk.");
      }
    });
    const stopMembers = videoApi.subscribeToMembers(roomId, () => {}, {
      onSync: (members) => {
        if (!valid()) return;
        const me = members.find((member) => member.userId === data.user.id);
        if (!me) { finish("You no longer have access to this Lynk."); return; }
        setState((previous) => previous.scope === scope && previous.data && previous.data.peer.role !== me.role
          ? { ...previous, data: { ...previous.data, peer: { ...previous.data.peer, role: me.role } } } : previous);
      },
    });
    return () => { active = false; stopEvents(); stopMembers(); };
  }, [admitted, data?.user.id, roomId, scope, owner, finish, notifyEnded]);

  const leave = useCallback(async () => {
    if (!lifetime.current.active || leavingRef.current || scopeRef.current !== scope || accountOwner() !== owner) return false;
    if (!admitted || !data) { finish(); exitRef.current(); return true; }
    const epoch = lifetime.current.epoch;
    const isCurrent = () => lifetime.current.active && lifetime.current.epoch === epoch &&
      scopeRef.current === scope && accountOwner() === owner;
    leavingRef.current = true;
    setLeaving(true);
    const result = await leaveRoomSafely({
      isHost: data.peer.role === "host", isCurrent,
      endRoom: () => videoApi.endRoom(roomId),
      leaveRoom: () => sneakyLynkApi.leaveRoom(roomId),
      exit: () => { finish(); exitRef.current(); },
      onFailure: (message) => setState((previous) => ({ ...previous, message })),
    });
    if (isCurrent()) { leavingRef.current = false; setLeaving(false); }
    return result;
  }, [admitted, data, roomId, owner, scope, finish]);

  const onTransportState = useCallback((transport: string) => {
    setConnectionStatus(transport === "live" ? "connected" : transport);
  }, []);

  return {
    mediaKey: JSON.stringify([scope, state.generation]),
    admitted, role: data?.peer.role, phase: current ? state.phase : "joining",
    message: current ? state.message : null, leaving, join, leave, onTransportState,
  };
}

export type GenesisRoomAdmission = ReturnType<typeof useGenesisRoomAdmission>;
