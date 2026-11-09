-- SOURCE ONLY. Run only after separately approved release prerequisites.
-- Additive schema, staged RLS gate, and ALL compatible Edge reader/writer versions
-- must be verified; old invocations AND outstanding old DB requests must be drained.
-- No traffic hold is needed: compatible readers preserve raw follows until this
-- transaction atomically captures relationships and switches to approval/grants.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.users,public.user_settings,public.follows,public.blocks,
  public.follow_requests,public.follow_access_cutovers,public.follow_legacy_access,public.public_follow_acceptances
  IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF to_regprocedure('public.post_follow_hidden(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Install the compatible staged post gate before cutover';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.user_settings'::regclass
    AND tgname='user_settings_sync_account_privacy' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Install the serialized privacy trigger before cutover';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' AND read_gate_version=1) THEN
    RAISE EXCEPTION 'Install the matching staged read-gate protocol before cutover';
  END IF;
END $$;
-- No REST writer may bypass the verified service or manufacture relationships.
-- Preserve existing SELECT permissions and every existing follow/count row.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.follows FROM PUBLIC, anon, authenticated;
DO $$ DECLARE col text; BEGIN
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.follows'::regclass
    AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%1$I), UPDATE (%1$I) ON public.follows FROM PUBLIC, anon, authenticated',col);
  END LOOP;
END $$;


-- Direct REVOKE does not remove privileges inherited from another role. Abort
-- atomically rather than publish a false client-write closure in that case.
DO $$ DECLARE role_name text; col text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.follows','INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'Inherited follow table writes remain for %',role_name;
    END IF;
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.follows'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
      IF has_column_privilege(role_name,'public.follows',col,'INSERT,UPDATE') THEN
        RAISE EXCEPTION 'Inherited follow column writes remain for %',role_name;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- A successful batch is never recaptured. Retries after rollback are safe;
-- retries after COMMIT preserve original membership and never resurrect grants.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' AND NOT ready) THEN
    INSERT INTO public.follow_legacy_access(follow_id,batch_id)
      SELECT id,'private-follow-v1' FROM public.follows;
    UPDATE public.follow_access_cutovers SET captured_at=clock_timestamp(),
      relationship_count=(SELECT count(*) FROM public.follows),ready=true
      WHERE batch_id='private-follow-v1' AND NOT ready;
  END IF;
END $$;
COMMIT;
NOTIFY pgrst, 'reload schema';
