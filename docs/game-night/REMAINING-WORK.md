# Game Night — Remaining-Work Matrix

Audit reference: master `a09b1dc9` (2026-09-24). Implementation branch: `game-night/impl`.
Status legend: **working** = implemented and verified; **partial** = implemented, gaps known; **absent** = not started; **unverified** = exists, not proven.

Updated 2026-09-25 after implementation slices landed. See VERIFICATION.md for the acceptance matrix.

## Backend / authority

| Requirement | Route / object | Status | Evidence |
|---|---|---|---|
| Durable create (atomic room + host membership, idempotent) | `game_night_create_room(idem, private)` | working | integration test + live prod call |
| Authorized join; valid code ≠ phantom room | `game_night_join_room`, `game_night_resolve_room` | working | `room_not_found` on bad code; browser-verified join-by-code |
| Seats 2-4 max; 5th → watcher | `game_night_players.seat_no` + partial unique index + join RPC | working | seat claims serialized by room lock; tested |
| Ready/unready, start, leave, end, rematch, kick, host handoff | `game_night_set_ready|start_match|leave_room|end_room|kick` | working | all covered in integration suite; ready/start browser-verified |
| Reconnect grace: seats persist; presence loss ≠ seat loss | membership rows persist until explicit leave/6h expiry | working | documented default; presence is display-only |
| Code reuse safety | live code unique; ended rooms release it; invites bind to room_id | working | `uniq_game_night_rooms_active_code` partial index |
| Recursive RLS fix | `game_night_is_member` SECURITY DEFINER | working | authenticated SELECT verified non-recursive |
| Private data isolation | hands/decks/submissions/duel_choices have NO client grants; `game_night_state` is sole surface | working | stranger/member/watcher projections tested |
| Classic match (3-4p) | matches/rounds/hands/submissions/decks + RPCs | working | full match simulated incl. scoring-once, refill, rotation |
| Duel mode (2p) | `duel_lock`/`duel_results` + `game_night_duel_choices` | working | secrecy + prediction scoring tested; live duel round browser-verified |
| Server deadlines; lazy advancement | `game_night_advance` inside every command + `game_night_ping` | working | forced-deadline transitions tested |
| Abandoned/expired rooms | abandonment <2 seated; 6h idle end | working | tested |
| Command ledger + idempotent commands | `game_night_commands` (room_id, command_id) + event ledger | working | duplicate submit/judge replay verified |
| Chat w/ rate limits | `game_night_messages` + `game_night_send_message` (10/10s, 30 reactions/60s) | working | rate-limit test passes; chat UI renders live |
| Leaderboard Top 10 + caller rank | `game_night_results` + `game_night_leaderboard(mode)` | working (backend); partial (no dedicated UI section yet) | tested after match completion |
| Original deck | `game_night_cards` v1: 40 prompts / 160 answers | working | seeded on prod |
| Realtime state delivery | `supabase_realtime` publication on matches/rounds/messages | working | publication live; hook refetches on postgres_changes; browser-verified |
| Server-signed broadcast topic separation | postgres_changes (server rows) + client presence/broadcast for social | working-by-design | no client-originated authoritative events exist |
| Yjs authoritative projection | `game-night-sync` edge fn + `game_night_yjs_snapshots/log` tables | working (backend); unverified (projector output not yet exercised by a client diff) | deployed; membership-gated; canonical hash compare |

## Client / screens (web)

| Requirement | Surface | Status | Evidence |
|---|---|---|---|
| Lobby create + join wired to RPCs | `screens/lobby.web.tsx` | working | browser-verified: create → room nav, join-by-code → room nav |
| Rooms list create wired | `screens/rooms-list.web.tsx` | unverified | same API path as lobby; list UI not exercised |
| `useGameNightState` hook | `use-game-state.ts` | working | drives live room screen in browser test |
| Room game UI: seats/ready/start/hand/prompt/submit/reveal/judge/results/rematch | `screens/room.web.tsx` + `components/` | partial | seats/ready/start/duel-prompt verified in two-browser run; submit/reveal/judge/result screens not yet browser-driven |
| Spectator states | room screen watcher branch | unverified | engine-verified projection; no browser spectator session run |
| Chat sheet + history + retries | `components/room-chat.web.tsx` | partial | renders with reactions + composer in browser snapshot; send/retry path not exercised |
| KLIPY picker + attribution | `components/game-night-klipy.web.tsx` | unverified | "Send a GIF" button present; picker not opened in test |
| Emoji reactions | `kind='reaction'` + reaction chips | unverified | chips render; send path not exercised |
| Leaderboard UI (Top 10 + my rank) | not built | **absent** | RPC ready; needs screen/section |
| Yjs client | `room-ydoc.ts`, `use-room-ydoc.ts`, mounted in `room.web.tsx` | unverified | sync indicator mounted; `game-night-sync` deployed; no diff round-trip asserted in browser |
| Table renderer (Skia/Reanimated baseline) | `components/table/game-table-scene.tsx` + `game-table.web/native.tsx` | unverified | mounted in room.web.tsx during active match; CanvasKit path chosen; 3/3 logic tests pass; not yet screenshotted |
| Three.js/TypeGPU/WebGPU enhancement | `components/table/enhanced-table.native.tsx` | unverified | native-only; GpuRuntime shared device; `canUseEnhanced()` false on web |
| Native routes + drawer entry + invite deep links | `screens/rooms-list.tsx`, `lobby.tsx`, `room.tsx`, protected routes | unverified | code exists; drawer destination + deep-link tests pass (8); no simulator/device run |
| Narrow-web discoverability | decision stands: link-only below 768px | working | docs 00-entry-points |

## Verification

| Check | Status |
|---|---|
| Engine integration suite (69 checks, disposable postgres) | working — `apps/mobile/supabase/__tests__/game-night-engine.integration.py` (rerun for final count pending) |
| e2e: real authenticated two-browser match (prod backend, `next build`+`next start`) | **working** — `apps/web/e2e/specs/game-night-match.spec.ts` passed 2026-09-25 |
| e2e: 3-player and 4-player matches | absent — only 3 E2E accounts would be needed; engine suite covers rules |
| e2e: spectator mid-round, kick, rematch, reconnect journeys | absent |
| Web production build | working — `pnpm build` passed (114 routes; game-night routes present) |
| iOS/Android builds + device runs | absent |
| Perf measurement on devices | absent |
| VERIFICATION.md | this update round |
