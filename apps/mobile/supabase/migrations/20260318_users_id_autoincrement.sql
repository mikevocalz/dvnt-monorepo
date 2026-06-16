-- REL-03: Add auto-increment sequence to users.id column
-- Prevents race condition on concurrent signups where id could be null.
-- Safe to re-run: uses IF NOT EXISTS and idempotent ALTER.

DO $$
DECLARE
  max_id integer;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM public.users;
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS users_id_seq START WITH %s', max_id + 1);
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN id SET DEFAULT nextval(''users_id_seq'')';
  EXECUTE 'ALTER SEQUENCE users_id_seq OWNED BY public.users.id';
END $$;
