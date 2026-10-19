-- Authors are versioned by Payload. The June author-field migrations added
-- these fields to the live document but omitted its history table, causing
-- every profile save to roll back while inserting the version snapshot.
-- Additive only: retain all historical values; unknown historical fields stay
-- NULL. Do not infer old ownership or copy today's photo into old snapshots.
ALTER TABLE payload._authors_v
  ADD COLUMN IF NOT EXISTS version_user_id integer,
  ADD COLUMN IF NOT EXISTS version_avatar_url varchar,
  ADD COLUMN IF NOT EXISTS version_socials_onlyfans varchar;

-- Match Payload's has-one relationship: nullable FK, SET NULL, nonunique index.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'payload._authors_v'::regclass
      AND conname = '_authors_v_version_user_id_admin_users_id_fk'
  ) THEN
    ALTER TABLE payload._authors_v
      ADD CONSTRAINT _authors_v_version_user_id_admin_users_id_fk
      FOREIGN KEY (version_user_id) REFERENCES payload.admin_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS _authors_v_version_version_user_idx
  ON payload._authors_v (version_user_id);
