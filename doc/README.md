# doc/

Build-out documents — distinct from the existing repo `docs/` which holds historical
audits, fit reports, and product notes. This directory is the gate-record for the
web-first build-out (see [`../AGENTS.md`](../AGENTS.md), [`../TASKS.md`](../TASKS.md)).

Expected contents (in order of gate):

- `processor-risk.md` — Stripe go/no-go for the web rail (gates G2, D3, all web payment).
- `entitlement-model.md` — Supabase schema, both webhooks, identity bridge (gates G3).

Nothing else lands here without a gate to pin it to.
