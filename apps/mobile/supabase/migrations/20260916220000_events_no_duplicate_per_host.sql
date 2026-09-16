-- A host cannot have two live events with the same title at the same time.
--
-- events_host_client_request_id_key already stops a retried publish from
-- creating two rows, but it only binds when the client sends a request id, so
-- it does nothing for an older client or for a host who genuinely taps Create
-- twice. Three duplicate pairs reached production this way: 71/72 (Game Night
-- LA), 79/81 (DC "Dick-Strict") and 87/88 (Wine & Whiskey). Two of them had a
-- live event sitting next to an empty twin at the same public URL, and the
-- slug route picked the wrong one.
--
-- date is coalesced because every one of those pairs had date NULL, which is
-- exactly the case a plain (host, title, date) index would have let through.
-- A recurring series is unaffected: different dates are different rows.
--
-- Cancelled events are excluded so a host can re-run an event they cancelled
-- without renaming the dead one first, and so cancelled originals already in
-- production do not block their live replacements.
--
-- Applied 16 September 2026 after clearing the three pairs above.
CREATE UNIQUE INDEX IF NOT EXISTS events_no_duplicate_live_title
  ON public.events (host_id, lower(btrim(title)), (COALESCE(date, '-infinity'::timestamptz)))
  WHERE COALESCE(status, 'active') <> 'cancelled';

COMMENT ON INDEX public.events_no_duplicate_live_title IS
  'One live event per host per title per date. Cancelled events are exempt. Complements events_host_client_request_id_key, which only binds when the client supplies a request id.';
