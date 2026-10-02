/**
 * game-night-sync Edge Function
 *
 * Server-only authoritative Yjs projection for Game Night rooms.
 *
 * The Postgres match engine owns all canonical game state. This function
 * projects the safe public view (`game_night_public_projection`) into a Yjs
 * document keyed by `room_id`, persists the update stream, and serves
 * state-vector diffs to members.
 *
 * Clients send ONLY a base64-encoded Yjs state vector. Any other doc content
 * is ignored. The service role is the sole writer.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Y from "https://esm.sh/yjs@13.6.27";
import {
  corsHeaders,
  optionsResponse,
  verifySessionDetailed,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const LOG_COMPACT_THRESHOLD = 200;

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function byteaToBytes(value: string | Uint8Array | null | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (!value || typeof value !== "string") {
    throw new Error("invalid bytea value");
  }
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  // Fall back to base64 for any non-hex encoding.
  return base64Decode(value);
}

function byteaFromBytes(bytes: Uint8Array): string {
  // PostgreSQL hex format: \\x...  In JSON it is transmitted as \\x...
  // (one literal backslash followed by x).
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface LogRow {
  seq: number;
  update: string | Uint8Array;
  canonical_hash: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });

  const session = await verifySessionDetailed(supabase, req);
  if (!session.ok) {
    const status = session.reason === "missing" ? 401 : 403;
    const message = session.reason === "missing"
      ? "Unauthorized"
      : "Invalid or expired session";
    return json({ error: message }, status, req);
  }
  const uid = session.userId;

  let body: { room_code?: unknown; state_vector_b64?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, req);
  }

  const roomCode = typeof body.room_code === "string" ? body.room_code : "";
  if (!roomCode.trim()) {
    return json({ error: "room_code is required" }, 400, req);
  }

  // 1. Resolve room by code. Only non-ended rooms are visible. Direct table
  // read: game_night_resolve_room RPC requires user JWT claims, which the
  // service role does not carry. Codes are uppercase-only, so an equality
  // match suffices — ilike would let %/_ wildcards alias another room.
  const { data: room, error: resolveErr } = await supabase
    .from("game_night_rooms")
    .select("id, room_code, status")
    .eq("room_code", roomCode.trim().toUpperCase())
    .neq("status", "ended")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (resolveErr) {
    console.error("[game-night-sync] resolve error:", resolveErr);
    return json({ error: "Failed to resolve room" }, 500, req);
  }
  if (!room) {
    return json({ error: "Room not found" }, 404, req);
  }
  const roomId = room.id;

  // 2. Membership check using the authenticated Better Auth user id.
  const { data: memberRows, error: memberErr } = await supabase.rpc(
    "game_night_is_member",
    { p_room_id: roomId, p_user_id: uid },
  );
  if (memberErr) {
    console.error("[game-night-sync] membership error:", memberErr);
    return json({ error: "Failed to check membership" }, 500, req);
  }
  const isMember = typeof memberRows === "boolean"
    ? memberRows
    : ((memberRows as unknown[] | null)?.[0] as Record<string, unknown> | undefined)
        ?.game_night_is_member === true;
  if (!isMember) {
    return json({ error: "Not a member of this room" }, 403, req);
  }

  // 3. Load the persisted Yjs document.
  const { data: snap, error: snapErr } = await supabase
    .from("game_night_yjs_snapshots")
    .select("update, seq, canonical_hash")
    .eq("room_id", roomId)
    .maybeSingle();

  if (snapErr) {
    console.error("[game-night-sync] snapshot error:", snapErr);
    return json({ error: "Failed to load document snapshot" }, 500, req);
  }

  const doc = new Y.Doc();

  if (snap) {
    try {
      Y.applyUpdate(doc, byteaToBytes(snap.update));
    } catch (e) {
      console.error("[game-night-sync] failed to apply snapshot:", e);
      // A corrupt snapshot is non-fatal: we replay the log below.
    }
  }

  const snapshotSeq = Number(snap?.seq ?? 0);

  const { data: logRows, error: logErr } = await supabase
    .from("game_night_yjs_log")
    .select("seq, update, canonical_hash")
    .eq("room_id", roomId)
    .gt("seq", snapshotSeq)
    .order("seq", { ascending: true });

  if (logErr) {
    console.error("[game-night-sync] log error:", logErr);
    return json({ error: "Failed to load update log" }, 500, req);
  }

  for (const row of (logRows ?? []) as LogRow[]) {
    try {
      Y.applyUpdate(doc, byteaToBytes(row.update));
    } catch (e) {
      console.error(`[game-night-sync] failed to apply log seq ${row.seq}:`, e);
    }
  }

  // 4. Compute the canonical projection and its hash.
  const { data: projRows, error: projErr } = await supabase.rpc(
    "game_night_public_projection",
    { p_room_id: roomId },
  );
  if (projErr || !projRows) {
    console.error("[game-night-sync] projection error:", projErr);
    return json({ error: "Failed to compute projection" }, 500, req);
  }

  const canonical =
    ((projRows as unknown[] | null)?.[0] as Record<string, unknown> | undefined)
      ?.game_night_public_projection ??
    ((projRows as Record<string, unknown> | undefined)
      ?.game_night_public_projection) ??
    projRows;
  const canonicalJson = JSON.stringify(canonical);
  const canonicalHash = await sha256Hex(canonicalJson);

  // 5. Determine the latest stored hash.
  let latestHash = snap?.canonical_hash ?? "";
  let latestSeq = snapshotSeq;
  for (const row of (logRows ?? []) as LogRow[]) {
    if (row.seq > latestSeq) {
      latestSeq = row.seq;
      latestHash = row.canonical_hash;
    }
  }

  // 6. Authoritative write: if the projection changed, mutate the doc and
  // append the resulting Yjs update to the log. Only the service role ever
  // writes here.
  let appended = false;
  if (canonicalHash !== latestHash) {
    let pending: Uint8Array | undefined;
    const captureUpdate = (update: Uint8Array) => {
      pending = update;
    };

    doc.on("update", captureUpdate);
    doc.transact(() => {
      doc.getMap("state").set("json", canonical);
    });
    doc.off("update", captureUpdate);

    if (pending) {
      const { error: insertErr } = await supabase
        .from("game_night_yjs_log")
        .insert({
          room_id: roomId,
          update: byteaFromBytes(pending),
          canonical_hash: canonicalHash,
        });
      if (insertErr) {
        console.error("[game-night-sync] log insert error:", insertErr);
        return json({ error: "Failed to persist update" }, 500, req);
      }
      latestHash = canonicalHash;
      appended = true;
    }
  }

  // 7. Periodically compact the log into a full snapshot.
  const totalLogRows = (logRows?.length ?? 0) + (appended ? 1 : 0);
  if (totalLogRows >= LOG_COMPACT_THRESHOLD) {
    const { data: maxSeqRow } = await supabase
      .from("game_night_yjs_log")
      .select("seq")
      .eq("room_id", roomId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxSeq = Number(maxSeqRow?.seq ?? latestSeq);

    const fullUpdate = Y.encodeStateAsUpdate(doc);
    const { error: upsertErr } = await supabase
      .from("game_night_yjs_snapshots")
      .upsert({
        room_id: roomId,
        update: byteaFromBytes(fullUpdate),
        seq: maxSeq,
        canonical_hash: latestHash,
        updated_at: new Date().toISOString(),
      });
    if (upsertErr) {
      console.error("[game-night-sync] snapshot upsert error:", upsertErr);
      // Non-fatal: keep serving the current document.
    } else {
      const { error: delErr } = await supabase
        .from("game_night_yjs_log")
        .delete()
        .eq("room_id", roomId)
        .lte("seq", maxSeq);
      if (delErr) {
        console.error("[game-night-sync] log delete error:", delErr);
      }
    }
  }

  // 8. Build the diff against the client's state vector, or the full update.
  let clientVector: Uint8Array | undefined;
  if (
    typeof body.state_vector_b64 === "string" &&
    body.state_vector_b64.trim()
  ) {
    try {
      clientVector = base64Decode(body.state_vector_b64);
    } catch (e) {
      console.error("[game-night-sync] invalid state vector:", e);
      // Ignore client vector and return the full update.
      clientVector = undefined;
    }
  }

  const update = Y.encodeStateAsUpdate(doc, clientVector);
  return json({ update_b64: base64Encode(update), canonical_hash: canonicalHash }, 200, req);
});
