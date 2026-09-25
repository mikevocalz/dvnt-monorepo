# Game Night — Verification Report

Branch: `game-night/impl` (base `origin/master`, audit SHA `a09b1dc9`).
Date: 2026-09-25. Everything below distinguishes code that exists from evidence it works.

## Commands run (verification lane)

| Command | Result |
|---|---|
| `python3 apps/mobile/supabase/__tests__/game-night-engine.integration.py` | 72/72 checks pass (disposable local Postgres, real migrations, real role claims) |
| `cd packages/app && npx tsc --noEmit --ignoreDeprecations "6.0"` | clean, 0 errors (repo tsconfig uses deprecated `baseUrl` — pre-existing) |
| `cd packages/app && npx tsx --test room-code seats room-ydoc table-render tests` | 17/17 pass |
| `cd apps/web && pnpm build` (`tsc --noEmit && next build --webpack`) | pass; 114 routes incl. `/game-night`, `/game-night/join`, `/game-night/room/[id]` |
| `cd apps/web && pnpm start -p 19006` + `npx playwright test e2e/specs/game-night-match.spec.ts --project=chromium-desktop-1440 --no-deps` | **2 pass** (2p duel ~27s, 4p classic full round ~53s), four real accounts, production Supabase |
| `npx supabase functions deploy game-night-sync` | deployed to `npfjanxturvmjyevoyfo` |
| Live prod match via PostgREST (earlier session) | full duel+classic flow driven with real minted JWTs: create idempotent, seats, hands private, anonymous reveal, score-once, watcher join, chat, code release |

## Acceptance matrix

| Requirement | Implemented | Backend verified | Browser verified | Native verified | Rollout |
|---|---|---|---|---|---|
| Durable create/join/seats (2-4, watcher overflow) | ✓ | ✓ engine + prod RPC | ✓ create + code-join in spec | code only | migrations+RPCs on prod |
| Match engine: lobby→…→results, deadlines, rematch | ✓ | ✓ 72 checks | partial (duel round live) | code only | on prod |
| Duel mode (2p) | ✓ | ✓ | ✓ prompt + duel round visible to peer | code only | on prod |
| Classic mode (3-4p) | ✓ | ✓ | ✓ 4p full round: submit→reveal→judge pick→results | code only | on prod |
| Private hands / stranger isolation / anonymous reveal | ✓ | ✓ | ✓ submit + judge pick driven in 4p | — | on prod |
| Chat text/GIF/reactions + rate limit + moderation base | ✓ | ✓ rate limit, member-only | chips/composer render; send unexercised | code only (Gorhom sheet) | on prod |
| KLIPY search/send + attribution | ✓ | ✓ gif message type | picker unopened | — | client code only |
| Scoring + Top 10 leaderboard | ✓ | ✓ | UI mounted (lobby + match end, universal RNW); live data render unexercised | mounted in native lobby | on prod |
| Yjs authoritative projection | ✓ | deployed; diff round-trip unexercised | sync indicator only | — | fn + tables on prod |
| Table renderer (Skia baseline / Three+TypeGPU native enhanced) | ✓ | 3/3 logic tests | mounted (match-active), not screenshotted | code only | client code only |
| Native routes + drawer + deep links | ✓ | 8 nav tests | — | not built | — |
| Reconnect/resume, kick enforcement live | ✓ | ✓ engine | — | — | on prod |

## Two-browser e2e evidence

`apps/web/e2e/specs/game-night-match.spec.ts`, project `chromium-desktop-1440`, `--no-deps`, `E2E_BASE_URL=http://localhost:19006` against `next build`+`next start` (production bundle, not dev server):

1. audit account: `/game-night/join` → "Start a room" → RPC `game_night_create_room` → navigated to `/game-night/room/{CODE}` (real code issued; first live room confirmed `EW2GCF` in manual diag).
2. peer account (independent browser context + storage state): `/game-night/join` → typed code → "Join room" → room screen, "Ready up" visible.
3. peer readied → host "Start game" enabled → started → peer saw `region "Prompt"` + `region "Duel round"` with "Pick what App Review chose".
4. 4p classic (audit host + peer + `gn3` + `gn4` storage states minted via `sign-up/email`): code-join ×3 → all ready → host starts → 3 writers each pick cards until "Play card" enables → submit → judge clicks "Pick winner" → `region "Round results"` on all four pages.

Bug found and fixed by this run: `game_night_players`/`game_night_rooms` were not in `supabase_realtime` nor subscribed by `use-game-state`, so host Start gating waited on the 20s poll. Migration `20260927000000` publishes both; the hook subscribes with room filters.

Snapshots confirmed: seat grid, "Copy join link", "End room", chat region with reaction buttons (👍😂🔥💀) and "Send a GIF", gated start ("Need at least 2 seated players").

### Infra findings worth keeping

- E2E must run on an origin allowed by `mint-supabase-jwt` CORS: `localhost:3000/8081/19006` or `127.0.0.1:3000`. `:5173` mints fail CORS → `not_authenticated` in the lobby.
- `localhost:3000` and `:8081` were occupied by a different project (Moyo) on this machine — `:19006` used.
- `audit.json`/`peer.json` storage states expire server-side; both were re-minted via `POST /api/auth/sign-in/email` during this run.

## Deployed to production (verified)

- Migrations `20260925000000` (match schema + RLS fix), `20260925010000` (match engine, ~30 RPCs), `20260925020000` (deck v1: 40 prompts/160 answers), `20260925030000` (Yjs snapshot/log), `20260926000000` (no-deck-recycle: spent prompt deck ends the match as completed — product rule from owner, verified by new engine checks), `20260927000000` (publish `game_night_players` + `game_night_rooms` to realtime). Ledger repaired/recorded via `migration repair`.
- Edge function `game-night-sync`.
- `supabase_realtime` publication on all five client-relevant game-night tables.
- **Not deployed:** any web/native client (branch unpushed, no Vercel build of this feature).

## Not verified (honest gaps)

- Spectator joining mid-round, kick removal while connected, rematch, refresh during every phase.
- Chat send/retry/moderation in browser; KLIPY picker and attribution.
- Yjs client diff round-trip and compaction behavior.
- Native builds (iOS/Android), Gorhom sheet behavior, device-loss/fallback rendering, performance numbers — no devices run this session.
- `rooms-list.web.tsx` screen driven in a browser; leaderboard live-data render (RPC verified, UI mounted but not exercised with real scores).
- Production deploy of the client — branch not pushed; no rollout performed.
