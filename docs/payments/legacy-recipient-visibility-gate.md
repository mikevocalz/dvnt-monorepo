# Legacy recipient visibility: hard rollout prerequisite

The proposed financial read model authorizes new-model allocations and externally recorded legacy receipts using immutable recipient identity. The existing plain legacy ledger and attribution tables do not freeze the user who originally earned each row. A current promoter roster assignment is not reliable proof after reassignment or removal.

## Compatibility impact

The draft withholds unproven historical net earnings and referral counts from all users, including legitimate current promoters, and labels them unavailable pending ownership review. It does not report zero, forgive an obligation, change payment status, mark anything paid, or erase records. Frozen actor-owned new allocations and external legacy receipts remain visible. Removed former recipients can see only their verified payment summary, not promoter setup, codes, management or roster powers.

**Do not deploy this historical-display change until open legacy obligations have reviewed frozen recipient identity and the default-empty actor-scoped bridge is populated through an authorized reconciliation.** The fix closes a privacy leak, but is not a completed legacy earnings experience. Legacy money still owed must remain on the operator reconciliation inventory throughout this process. A draft publication does not waive this gate.

## Client compatibility gate

Historical totals are nullable and reviewed history uses separate typed fields. Coordinate backend and web/native client rollout, including the supported minimum mobile version. Any older consumer that coerces unavailable/null totals to zero must be upgraded or blocked with an explicit update/unavailable response before this API contract is enabled. Do not deploy the backend contract alone and assume all installed clients understand it.

## Implemented default-empty reviewed bridge

The draft adds an append-only, private reviewed ownership registry binding an exact legacy ledger row and source order, promoter identity, beneficiary user, amount, currency and immutable evidence reference. Review who earned the obligation independently of whether it has ever been paid. Do not fabricate an external receipt, Stripe transfer, bank proof, or paid status to gain a display record.

No automatic backfill from the current promoter row is allowed. A reviewed reconciliation must establish ownership using historical source evidence, retain provenance and handle contradictions through manual review. New registry writes need the appropriate separate authorization; this offline engineering did not create production records or authorize a data migration. The read path exposes only exact actor-owned rows, partition external/new rows without double counting, and retain explicit unverified status for missing or conflicting evidence.

SQL, endpoint and mounted tests cover exact ownership, reassignment/removal, refunds/reversals, mixed currencies, external/new overlap, no-evidence denial and former-recipient history. The bridge reports reviewed legacy earnings with payment status explicitly unverified, not a pending/paid/transfer/bank claim. Changed or incomplete source evidence withholds the amount for renewed review. No provision RPC exists and no ownership records are seeded. Until authorized real-identity reconciliation is complete, unproven legacy totals remain blocked rather than guessed.
