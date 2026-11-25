# Remaining DVNT web checklist: integration only

One coordinated production release for the remaining work. Do not merge or deploy this QA draft. The already-approved one-tap posting correction (#306) is on the production baseline, not a separate pending item.

| Item | Integrated proof | Still required |
| --- | --- | --- |
| Short standalone MOV/MP4 | Background duration/dimension verification replaces detached first-frame decoding. No checking panel. A real two-second MOV was selected and shared once to simulated transport in phone-sized Chromium; 61 seconds was rejected. | Actual affected iPhone clip and playback. The Live Photo motion-pair guard is separate. |
| Light, color, sharpness and photo filters | Additional controls in the existing web editor. Preview adjustment, Reset, and actual JPEG export at the selected crop resolution. Animated GIFs and Live Photo assets keep their original bytes when a still is edited. | Hosted browser acceptance and physical iPhone camera/Live Photo capture. |
| Staff email for an invited person without an account | #308 blocks issuance if sender/worker settings are incomplete. In the local integrated regression, invitation queued before signup, simulated provider receives one request, wrong or unverified recipients denied, repeat accept grants only one role. | Restricted staging sender and scheduler, real inbox and intact link, genuine verified signup and acceptance. Staff invite Web Push now uses the existing VAPID sender instead of Expo; the exact Edge patch passed fake-provider routing tests, but real device receipt is not proven. Do not use checkout phone as a verified login factor. Email is the supported alternative once delivered. |
| Host Stripe setup reminder | #307 is a disabled-only contract, durable test ledger and restricted private staging adapter under draft-only paths. No grant, scheduler or outbound send. | Approve/install the restricted staging role and wire authorized data lookup, suppression, sender and scheduler; verify delivery and duplicate prevention against a staging inbox. |
| Promoter kickbacks | Existing payout worker recovery tests pass against synthetic Stripe; not wired or enabled by this branch. | Access to dedicated DVNT Payout QA sandbox with test-only transfers; verify exact settlement and guards without movement in live Stripe. Keep external-payment quarantine in place. |

The old manual-review posting proposal is excluded. Native app and AI changes are excluded.
