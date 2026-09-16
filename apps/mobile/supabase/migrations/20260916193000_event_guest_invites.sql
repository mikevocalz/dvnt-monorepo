-- Guest list for private events.
--
-- `event_invites` has existed since 20260301_events_ticketing_v2.sql and has
-- never had a writer, so selecting "Private" on the create screen left the host
-- with no way to say who is invited. `event-invite-guests` is the writer. This
-- migration adds the two things it needs and nothing else:
--
--   1. Uniqueness, so re-inviting the same person is a no-op rather than a
--      second row and a second push.
--   2. A claim rule for email invites, so an address with no account today
--      becomes access the moment a real account proves it owns that address.
--
-- RLS is deliberately untouched: `event_invites_insert` still requires the
-- caller be `events.host_id`, and the edge function writes with the service
-- role after checking owner-or-admin itself. Nobody can self-invite.

-- ── 1. Idempotency ────────────────────────────────────────────────────────
-- Partial, because a row carries either a user id or an email, never both.
-- Production has zero rows, so neither index can fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS event_invites_unique_user
  ON public.event_invites (event_id, invited_user_id)
  WHERE invited_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_invites_unique_email
  ON public.event_invites (event_id, lower(invited_email))
  WHERE invited_email IS NOT NULL;

-- Revoking is a delete by the host. There is no DELETE policy and none is
-- added: revocation runs through the edge function on the service role, which
-- is the same path that created the row.
CREATE INDEX IF NOT EXISTS idx_event_invites_email
  ON public.event_invites (lower(invited_email))
  WHERE invited_email IS NOT NULL;

-- ── 2. The email claim ────────────────────────────────────────────────────
-- Extends 20260916121000_private_event_access_boundary.sql. Every clause there
-- is preserved verbatim; the only addition is the `invited_email` branch.
--
-- An unverified email is not proof of account ownership, so the join requires
-- `auth.users.email_confirmed_at IS NOT NULL`. Anyone can type an address into
-- a signup form; only the mailbox owner can confirm it. `raw_user_meta_data`
-- and the JWT's `email_verified` claim are user-editable and are never read.
CREATE OR REPLACE FUNCTION public.can_view_event(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (
      COALESCE(auth.jwt()->>'role', '') = 'service_role'
      OR COALESCE(e.visibility, 'public') <> 'private'
      OR (auth.jwt()->>'sub' IS NOT NULL AND (
        e.host_id = auth.jwt()->>'sub'
        -- Viewing is not acting. A staff invite is an invitation from the moment
        -- the host sends it, and event_co_organizers has no INSERT policy, so a
        -- pending row is always host-authored and never self-granted. Requiring
        -- accepted = true here would 404 the one screen an invitee has to open
        -- in order to accept. Privileges still require accepted = true; they are
        -- checked where they are used, not here.
        OR EXISTS (SELECT 1 FROM public.event_co_organizers c
          WHERE c.event_id = e.id AND c.user_id = auth.jwt()->>'sub')
        -- status is nullable with default 'pending'; a NULL must read as pending
        -- rather than silently dropping the invitee out of their own guest list.
        OR EXISTS (SELECT 1 FROM public.event_invites i
          WHERE i.event_id = e.id AND i.invited_user_id = auth.jwt()->>'sub'
            AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
        -- Email invite, claimed. The address alone grants nothing: it has to be
        -- the confirmed address of the account making this request.
        OR EXISTS (SELECT 1 FROM public.event_invites i
          JOIN auth.users au ON lower(au.email) = lower(i.invited_email)
          WHERE i.event_id = e.id
            AND i.invited_email IS NOT NULL
            AND au.id::text = auth.jwt()->>'sub'
            AND au.email_confirmed_at IS NOT NULL
            AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
        OR EXISTS (SELECT 1 FROM public.tickets t
          WHERE t.event_id = e.id AND t.user_id = auth.jwt()->>'sub'
            AND t.category = 'admission' AND t.status IN ('active', 'scanned'))
      ))
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_event(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_event(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_view_event(integer) IS
  'True when the caller may open event p_event_id. Public and link-only events are open; a private event admits its host, anyone with a co-organizer row, anyone on the guest list (event_invites, by auth id or by an address their account has verified), and any admission ticket holder. Nobody else, including anonymous viewers and callers supplying someone else''s profile id.';

NOTIFY pgrst, 'reload schema';
