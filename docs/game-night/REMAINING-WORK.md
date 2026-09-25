# Game Night — Remaining-Work Matrix

Audit reference: master `a09b1dc9` (2026-09-24). Implementation branch: `game-night/impl`.
Status legend: **working** = implemented and verified; **partial** = implemented, gaps known; **absent** = not started; **unverified** = exists, not proven.

## Backend / authority

| Requirement | Route / object | Status | Evidence |
|---|---|---|---|
| Durable create (atomic room + host membership, idempotent) | `game_night_create_room(idem, private)` | working | engine integration test: idempotent replay returns same room |
| Authorized join; valid code ≠ phantom room | `game_night_join_room`, `game_night_resolve_room` | working | `room_not_found` on bad code; resolve returns minimal truth |
| Seats 2-4 max; 5th → watcher | `game_night_players.seat_no` + partial unique index + join RPC | working | seat claims serialized by room lock; tested |
| Ready/unready, start, leave, end, rematch, kick, host handoff | `game_night_set_ready|start_match|leave_room|end_room|kick` | working | all covered in integration suite |
| Reconnect grace: seats persist; presence loss ≠ seat loss | membership rows persist until explicit leave/6h expiry | working | documented default; presence is display-only |
| Code reuse safety | live code is unique; ended rooms release it; invites bind to room_id, not code | working | `uniq_game_night_rooms_active_code` partial index |
| Recursive RLS fix | `game_night_is_member` SECURITY DEFINER | working | authenticated SELECT verified non-recursive |
| Private data isolation | hands/decks/submissions/duel_choices have NO client grants; `game_night_state` is sole surface | working | stranger/member/watcher projections tested |
| Classic match (3-4p) | matches/rounds/hands/submissions/decks + RPCs | working | full match simulated incl. scoring-once, refill, rotation |
| Duel mode (2p) | `duel_lock`/`duel_results` + `game_night_duel_choices` | working | subject-pick secrecy + prediction scoring tested |
| Server deadlines; lazy advancement | `game_night_advance` inside every command + `game_night_ping` | working | forced-deadline transitions tested |
| Abandoned/expired rooms | abandonment <2 seated; 6h idle end | working | tested |
| Command ledger + idempotent commands | `game_night_commands` (room_id, command_id) + event ledger | working | duplicate submit/judge replay verified |
| Chat w/ rate limits | `game_night_messages` + `game_night_send_message` (10/10s, 30 reactions/60s) | working | rate-limit test passes |
| Leaderboard Top 10 + caller rank | `game_night_results` + `game_night_leaderboard(mode)` | working | tested after match completion |
| Original deck | `game_night_cards` v1: 40 prompts / 160 answers | working | seeded on prod |
| Realtime state delivery | `supabase_realtime` publication on matches/rounds/messages | partial | publication added; delivery via client subscription pending client build |
| Server-signed broadcast topic separation | not built — using postgres_changes (server rows) + client presence/broadcast for social | working-by-design | no client-originated authoritative events exist |

## Client / screens (web)

| Requirement | Surface | Status | Evidence |
|---|---|---|---|
| Lobby create + join wired to RPCs | `screens/lobby.web.tsx` | in progress | subagent |
| Rooms list create wired | `screens/rooms-list.web.tsx` | in progress | subagent |
| `useGameNightState` hook (fetch + postgres_changes + ping poll) | `use-game-state.ts` | in progress | subagent |
| Room game UI: seats/ready/start/hand/prompt/submit/reveal/judge/results/rematch | `screens/room.web.tsx` + `components/` | in progress | subagent |
| Spectator states | room screen | in progress | subagent |
| Chat sheet + history + retries | `components/room-chat.web.tsx` | in progress | subagent |
| KLIPY picker + attribution + "Search KLIPY" placeholder | `components/game-night-klipy.web.tsx` | in progress | reuses `features/stickers/api/klipy.ts` |
| Emoji reactions | kind='reaction' + display | in progress | subagent |
| Leaderboard UI | not started | absent | RPC ready |
| Yjs authoritative projection layer | not started | absent | design below |
| Table renderer (Skia/Reanimated baseline) | not started | absent | ADR-003 path |
| Three.js/TypeGPU/WebGPU enhancement | not started | absent | deps installed (three 0.186, typegpu 0.12.5, rn-webgpu 0.10.2) |
| Native routes + drawer entry + invite deep links | not started | absent | registry pattern documented |
| Narrow-web discoverability | decision stands: link-only below 768px | working | docs 00-entry-points |

## Verification

| Check | Status |
|---|---|
| Engine integration suite (69 checks, disposable postgres) | working — `apps/mobile/supabase/__tests__/game-night-engine.integration.py` |
| e2e: real authenticated multi-browser match | absent |
| Perf measurement on devices | absent |
| VERIFICATION.md | absent — will be produced at completion |
