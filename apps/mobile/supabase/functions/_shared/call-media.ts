/**
 * Call-only provisioning: serialize room/peer creation and replace the caller's
 * prior peer before returning another token. SQL owns admission and lease fencing.
 * Provider paths/shapes match video_join_room and video_kick_user.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function provisionCallMedia(params: {
  supabaseUrl: string;
  serviceKey: string;
  fishjamBaseUrl: string;
  fishjamApiKey: string;
  roomId: string;
  userId: string;
}) {
  const { roomId, userId, fishjamBaseUrl, fishjamApiKey } = params;
  const supabase = createClient(params.supabaseUrl, params.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
  });
  const leaseId = crypto.randomUUID();
  let held = false;
  let committed = false;
  let createdRoom = false;
  let providerRoomId: string | null = null;
  let newPeerId: string | null = null;
  let mediaDeadline = Infinity;
  const provider = (
    path: string,
    method = "GET",
    body?: unknown,
    cleanup = false,
  ) => {
    if (!cleanup && Date.now() >= mediaDeadline) {
      throw new Error("Call provisioning deadline exceeded");
    }
    return fetch(`${fishjamBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${fishjamApiKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
  };

  try {
    let admission;
    const deadline = Date.now() + 15_000;
    do {
      const result = await supabase.rpc("begin_call_media", {
        p_room_uuid: roomId,
        p_user_id: userId,
        p_lease_id: leaseId,
      });
      if (result.error || !result.data) {
        throw new Error("Call admission failed");
      }
      admission = result.data;
      if (admission.reason !== "call_join_pending") break;
      if (Date.now() >= deadline) {
        return { ok: false as const, reason: "call_join_pending" };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (true);
    if (!admission.ok) {
      return {
        ok: false as const,
        reason: String(admission.reason),
        current: admission.current,
      };
    }
    held = true;
    // Finish/cleanup have at least 40 seconds remaining on the SQL lease.
    mediaDeadline = Date.now() + 45_000;
    providerRoomId = admission.fishjamRoomId;
    const previousPeers: { roomId: string; peerId: string }[] = [];
    if (providerRoomId) {
      const existingRoom = await provider(`/room/${providerRoomId}`);
      if (existingRoom.status === 404) providerRoomId = null;
      else {
        if (!existingRoom.ok) {
          throw new Error("Call media room could not be inspected");
        }
        const payload = await existingRoom.json();
        // Covers calls established before the server-owned peer registry shipped.
        for (const peer of payload.data?.room?.peers ?? []) {
          if (peer.metadata?.userId === userId && typeof peer.id === "string") {
            previousPeers.push({ roomId: providerRoomId, peerId: peer.id });
          }
        }
      }
    }
    if (
      admission.previousPeerId && admission.previousFishjamRoomId &&
      !previousPeers.some((peer) =>
        peer.peerId === admission.previousPeerId &&
        peer.roomId === admission.previousFishjamRoomId
      )
    ) {
      previousPeers.push({
        roomId: admission.previousFishjamRoomId,
        peerId: admission.previousPeerId,
      });
    }
    // Remove the caller's old connections before minting another token. A 404
    // is already absent; any other failure refuses the replacement.
    for (const previous of previousPeers) {
      const removed = await provider(
        `/room/${previous.roomId}/peer/${previous.peerId}`,
        "DELETE",
      );
      if (!removed.ok && removed.status !== 404) {
        throw new Error("Previous call connection could not be removed");
      }
    }
    if (!providerRoomId) {
      const created = await provider("/room", "POST", {
        maxPeers: 4,
        videoCodec: "h264",
      });
      if (!created.ok) throw new Error("Call media room could not be created");
      const payload = await created.json();
      providerRoomId = payload.data?.room?.id;
      if (!providerRoomId) {
        throw new Error("Call media room response was invalid");
      }
      createdRoom = true;
    }
    const peerResponse = await provider(
      `/room/${providerRoomId}/peer`,
      "POST",
      { type: "webrtc" },
    );
    // Do not destroy a live group room in response to one peer failure.
    if (!peerResponse.ok) {
      throw new Error("Call connection could not be created");
    }
    const peerPayload = await peerResponse.json();
    newPeerId = peerPayload.data?.peer?.id;
    const token = peerPayload.data?.token;
    if (!newPeerId || typeof token !== "string" || !token) {
      throw new Error("Call connection response was invalid");
    }
    const { data: profile } = await supabase.from("users").select(
      "username, avatar:avatar_id(url)",
    )
      .eq("auth_id", userId).maybeSingle();
    const avatar = Array.isArray(profile?.avatar)
      ? profile.avatar[0]
      : profile?.avatar;
    const { data: stored, error: storeError } = await supabase.rpc(
      "finish_call_media",
      {
        p_room_uuid: roomId,
        p_lease_id: leaseId,
        p_fishjam_room_id: providerRoomId,
        p_peer_id: newPeerId,
      },
    );
    if (storeError || stored !== true) {
      throw new Error("Call connection could not be confirmed");
    }
    committed = true;
    held = false;
    return {
      ok: true as const,
      fishjamRoomId: providerRoomId,
      token,
      peer: { id: newPeerId, role: admission.role },
      user: {
        id: userId,
        username: profile?.username ?? null,
        displayName: profile?.username ?? null,
        avatar: avatar?.url ?? null,
        isAnonymous: false,
        anonLabel: null,
      },
    };
  } catch {
    return { ok: false as const, reason: "media_unavailable" };
  } finally {
    if (!committed && providerRoomId && (createdRoom || newPeerId)) {
      const cleanupPath = createdRoom
        ? `/room/${providerRoomId}`
        : `/room/${providerRoomId}/peer/${newPeerId}`;
      let removed = false;
      for (let attempt = 0; attempt < 3 && !removed; attempt++) {
        try {
          const response = await provider(
            cleanupPath,
            "DELETE",
            undefined,
            true,
          );
          removed = response.ok || response.status === 404;
        } catch {
          // The same DELETE is safe to retry after a transport failure.
        }
      }
      if (!removed) {
        console.error(
          "[call-media] Provider cleanup failed; call connection was not returned",
        );
      }
    }
    if (held) {
      try {
        const result = await supabase.rpc("finish_call_media", {
          p_room_uuid: roomId,
          p_lease_id: leaseId,
        });
        if (result.error) throw new Error("Admission cleanup failed");
      } catch {
        console.error(
          "[call-media] Admission cleanup failed; lease expires after 90 seconds",
        );
      }
    }
  }
}
