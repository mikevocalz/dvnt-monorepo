# Remaining DVNT web checklist: integration only

One coordinated production release for the remaining work. Do not merge or deploy this QA draft. The already-approved one-tap posting correction (#306) is on the production baseline, not a separate pending item.

| Item | Integrated proof | Still required |
| --- | --- | --- |
| Light, color, sharpness and photo filters | Additional controls in the existing web editor. Preview adjustment, Reset, and actual JPEG export at the selected crop resolution. Animated GIFs and Live Photo assets keep their original bytes when a still is edited. | Hosted browser acceptance and physical iPhone camera/Live Photo capture. |
| Staff email for an invited person without an account | #308 blocks issuance if sender/worker settings are incomplete. In the local integrated regression, invitation queued before signup, simulated provider receives one request, wrong or unverified recipients denied, repeat accept grants only one role. | Restricted staging sender and scheduler, real inbox and intact link, genuine verified signup and acceptance; real push is separate. Do not use checkout phone as a verified login factor. Email is the supported alternative once delivered. |
| Host Stripe setup reminder | #307 is an offline contract and durable test ledger only, with no runtime grant, scheduler or outbound sends. | Wire a restricted service adapter, validate sender and suppression, and test a verified inbox and duplicate prevention in staging. |
| Promoter kickbacks | Existing payout worker recovery tests pass against synthetic Stripe; not wired or enabled by this branch. | Access to dedicated DVNT Payout QA sandbox with test-only transfers; verify exact settlement and guards without movement in live Stripe. Keep external-payment quarantine in place. |

The old manual-review posting proposal is excluded. Native app and AI changes are excluded.
