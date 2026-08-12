-- WS-1: split personal calls from Sneaky Lynk at the data-model level.
-- A 1:1 call has been a video_rooms row with is_public=false — a boolean flag
-- doing the job of a domain boundary. room_kind makes the domain explicit so
-- listing/RLS can exclude calls STRUCTURALLY instead of by flag discipline.
--
-- Additive only (standing rule: no destructive DML in migrations). Default
-- 'lynk' keeps every existing insert path working unchanged; the new
-- call_create edge function is the only writer of 'call'.
--
-- Backfill discriminator: is_public=false does NOT identify calls (private
-- invite-only Lynks exist). call_signals.room_id stores video_rooms.uuid
-- (verified live 2026-08-12: newest 3 signals match rooms 377-379), so a room
-- ever referenced by a call signal is a call. Signals may reference deleted
-- rooms (162 signal rooms vs 134 rooms) — the subquery only stamps survivors.

alter table public.video_rooms
  add column if not exists room_kind text not null default 'lynk'
  constraint video_rooms_room_kind_check check (room_kind in ('call', 'lynk'));

update public.video_rooms
   set room_kind = 'call'
 where uuid::text in (select room_id from public.call_signals)
   and room_kind <> 'call';

-- Lynk listing / discovery reads filter on kind; partial index keeps the hot
-- "open public lynks" query cheap.
create index if not exists video_rooms_kind_status_idx
  on public.video_rooms (room_kind, status)
  where room_kind = 'lynk';

-- ROLLBACK (exercised on branch ws1-rollback-drill):
--   drop index if exists video_rooms_kind_status_idx;
--   alter table public.video_rooms drop column if exists room_kind;
-- Old clients never send room_kind; new edge functions are additive files —
-- reverting the client pointer restores today's behavior exactly.
