-- One-account-per-person (name+DOB half): sha256 of normalized document
-- name + date of birth. Plaintext legal name is NEVER stored — only the
-- hash, used solely to detect the same document verifying a second account.
-- Applied 2026-07-22 via psql.
alter table public.identity_verifications add column if not exists identity_hash text;
create index if not exists identity_verifications_hash_idx
  on public.identity_verifications (identity_hash) where identity_hash is not null;
