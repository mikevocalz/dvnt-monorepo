-- Applied via MCP as `grant_ticket_addons_read`; recorded here so the repo
-- matches the database.
--
-- `[Addons] getByEvent error: permission denied for table ticket_addons`
-- (42501) fired on every event page. 42501 is a GRANT failure, not an RLS
-- decision: the table already carries `addons_public_read USING (true)`, but
-- a policy can only narrow what a grant allows, and 20260806400000's grant
-- was never applied to this database.
grant select on public.ticket_addons to authenticated, anon;
