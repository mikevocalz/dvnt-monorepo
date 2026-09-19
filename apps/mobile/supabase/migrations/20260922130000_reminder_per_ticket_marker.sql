-- Per-ticket reminder marker — makes the 3-hour reminder exactly-once
-- per recipient even when a send partially fails.
--
-- Before this, the sweep stamped events.reminder_sent_at only when ALL
-- sends succeeded; a partial failure retried the whole event and
-- double-emailed everyone whose mail already went out. Now each ticket
-- carries reminder_sent_at; the sweep only mails recipients who still
-- have unflagged tickets, and stamps the event when none remain.
--
-- Rollback: drop column reminder_sent_at on tickets (the event-level
-- column stays authoritative and the deployed fn falls back cleanly if
-- redeployed to the previous version).

alter table public.tickets
  add column if not exists reminder_sent_at timestamptz;

comment on column public.tickets.reminder_sent_at is
  'Set when this ticket was included in a 3-hour reminder email. The sweep never re-mails a flagged ticket.';
