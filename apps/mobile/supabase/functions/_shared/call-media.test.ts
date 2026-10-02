import { provisionCallMedia } from "./call-media.ts";
import {
  CALL_HUMAN_CAPACITY,
  CALL_PROVIDER_MAX_PEERS,
  pendingWaitMs,
} from "./call-capacity.ts";

const params = {
  supabaseUrl: "https://database.invalid",
  serviceKey: "test-service-key",
  fishjamBaseUrl: "https://provider.invalid",
  fishjamApiKey: "test-provider-key",
  roomId: "11111111-1111-4111-8111-111111111111",
  userId: "test-user",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function scenario(options: {
  staleRoom?: boolean;
  legacyPeers?: boolean;
  previous?: boolean;
  capacity?: boolean;
  peerFailure?: boolean;
  finishFailure?: boolean;
  deleteFailure?: boolean;
  pendingCount?: number;
}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let released = false;
  let beginAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.hostname === "database.invalid") {
      if (url.pathname.endsWith("/begin_call_media")) {
        beginAttempts++;
        if (
          options.pendingCount && beginAttempts <= options.pendingCount
        ) {
          return json({ ok: false, reason: "call_join_pending" });
        }
        return json(
          options.capacity
            ? {
              ok: false,
              reason: "call_full",
              current: CALL_HUMAN_CAPACITY,
              max: CALL_HUMAN_CAPACITY,
            }
            : {
              ok: true,
              role: "participant",
              roomId: 1,
              fishjamRoomId: options.previous ? "existing-room" : null,
              previousPeerId: options.previous ? "old-peer" : null,
              previousFishjamRoomId: options.previous ? "existing-room" : null,
            },
        );
      }
      if (url.pathname.endsWith("/finish_call_media")) {
        const body = JSON.parse(String(init?.body));
        if (!body.p_peer_id) released = true;
        return json(body.p_peer_id ? !options.finishFailure : true);
      }
      if (url.pathname === "/rest/v1/users") {
        return json({ username: "test-user", avatar: [{ url: "avatar" }] });
      }
    }
    if (url.hostname === "provider.invalid") {
      if (method === "GET") {
        if (options.staleRoom) return json({}, 404);
        return json({
          data: {
            room: {
              peers: options.legacyPeers
                ? [{ id: "legacy-peer", metadata: { userId: "test-user" } }, {
                  id: "other-peer",
                  metadata: { userId: "other-user" },
                }]
                : [],
            },
          },
        });
      }
      if (method === "DELETE") {
        return json({}, options.deleteFailure ? 500 : 200);
      }
      if (url.pathname === "/room" && method === "POST") {
        assert(
          JSON.parse(String(init?.body)).maxPeers === CALL_PROVIDER_MAX_PEERS,
          "Provider must cap peers at human capacity plus headroom",
        );
        return json({ data: { room: { id: "new-room" } } });
      }
      if (url.pathname.endsWith("/peer") && method === "POST") {
        return options.peerFailure ? json({}, 503) : json({
          data: { peer: { id: "new-peer" }, token: "test-peer-token" },
        });
      }
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  try {
    const result = await provisionCallMedia(params);
    return { result, calls, released };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("first call join provisions one capped provider room and persists its peer before returning token", async () => {
  const { result, calls, released } = await scenario({});
  assert(
    result.ok && result.token === "test-peer-token",
    "Expected confirmed peer token",
  );
  assert(
    calls.filter((call) => call === "POST /room").length === 1,
    "One provider room",
  );
  assert(
    calls.includes("POST /rest/v1/rpc/finish_call_media"),
    "Peer must be persisted",
  );
  assert(!released, "Successful admission should remain active");
});

Deno.test("reconnect removes old peer before replacement and reuses provider room", async () => {
  const { result, calls } = await scenario({ previous: true });
  assert(result.ok, "Reconnect should succeed");
  assert(
    calls.indexOf("DELETE /room/existing-room/peer/old-peer") <
      calls.indexOf("POST /room/existing-room/peer"),
    "Delete must precede mint",
  );
  assert(
    !calls.includes("POST /room"),
    "Reconnect must not create another room",
  );
});

Deno.test("full call never touches media provider and reports human capacity", async () => {
  const { result, calls } = await scenario({ capacity: true });
  assert(!result.ok && result.reason === "call_full", "Expected call_full");
  assert(
    (result as any).current === CALL_HUMAN_CAPACITY &&
      (result as any).max === CALL_HUMAN_CAPACITY,
    "Capacity details must reflect human capacity",
  );
  assert(
    calls.length === 1,
    "Capacity rejection must stop before provider traffic",
  );
});

Deno.test("failed provider creation releases admission and removes new room", async () => {
  const { result, calls, released } = await scenario({ peerFailure: true });
  assert(
    !result.ok && released,
    "Failed media must release newly admitted seat",
  );
  assert(
    calls.includes("DELETE /room/new-room"),
    "Unused provider room must be removed",
  );
});

Deno.test("failed peer persistence deletes minted peer and returns no token", async () => {
  const { result, calls, released } = await scenario({
    previous: true,
    finishFailure: true,
  });
  assert(!result.ok && released, "No token on persistence failure");
  assert(
    calls.includes("DELETE /room/existing-room/peer/new-peer"),
    "Unconfirmed peer must be removed",
  );
});

Deno.test("failed previous peer removal refuses to mint a duplicate", async () => {
  const { result, calls, released } = await scenario({
    previous: true,
    deleteFailure: true,
  });
  assert(!result.ok && released, "Removal failure must fail closed");
  assert(
    !calls.includes("POST /room/existing-room/peer"),
    "Do not mint a second peer",
  );
});

Deno.test("verified missing provider room is recreated under the same lease", async () => {
  const { result, calls } = await scenario({ previous: true, staleRoom: true });
  assert(result.ok, "Missing room recovery should succeed");
  assert(
    calls.includes("POST /room"),
    "Create only after provider confirms room missing",
  );
});

Deno.test("legacy caller peers are removed without disturbing another participant", async () => {
  const { result, calls } = await scenario({
    previous: true,
    legacyPeers: true,
  });
  assert(result.ok, "Legacy reconnect should succeed");
  assert(
    calls.includes("DELETE /room/existing-room/peer/legacy-peer"),
    "Remove caller legacy peer",
  );
  assert(
    !calls.includes("DELETE /room/existing-room/peer/other-peer"),
    "Preserve another participant",
  );
});

Deno.test("pending-join poll uses bounded exponential backoff", () => {
  // Base curve: 250, 500, 1000, 2000, 4000, 8000, then capped.
  const expected = [250, 500, 1000, 2000, 4000, 8000, 8000];
  const observed = [0, 1, 2, 3, 4, 5, 6].map((i) => pendingWaitMs(i, 8_000));
  assert(
    observed.every((ms, i) => ms >= expected[i] && ms < expected[i] + 200),
    "Each delay equals the base plus bounded jitter",
  );
});

Deno.test("waits through a pending lease with bounded backoff then succeeds", async () => {
  const { result, calls } = await scenario({ pendingCount: 3 });
  assert(result.ok, "Should succeed once the pending lease clears");
  assert(
    calls.filter((call) => call.endsWith("/begin_call_media")).length >= 4,
    "Must retry begin_call_media while the lease is pending",
  );
});
