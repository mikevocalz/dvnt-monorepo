# Remaining DVNT web checklist: integration only

One coordinated production release for the remaining work. Do not merge or deploy this QA draft. The already-approved one-tap posting correction (#306) is on the production baseline, not a separate pending item.

| Item | Integrated proof | Still required |
| --- | --- | --- |
| Short standalone MOV/MP4 | Background duration/dimension verification replaces detached first-frame decoding. No checking panel. A real two-second MOV was selected and shared once to simulated transport in phone-sized Chromium; 61 seconds was rejected. | Actual affected iPhone clip and playback. The Live Photo motion-pair guard is separate. |
| Light, color, sharpness and photo filters | Additional controls in the existing web editor. Preview adjustment, Reset, and actual JPEG export at the selected crop resolution. Animated GIFs and Live Photo assets keep their original bytes when a still is edited. | Hosted browser acceptance and physical iPhone camera/Live Photo capture. |
| Staff and co-hosts | Existing DVNT accounts only, using Event Staff and the existing in-app invitation flow. The candidate keeps Activity and Web Push for existing accounts. | Hosted push/Activity verification as applicable. No email-invite or host Stripe reminder email feature is included. |
| Promoter kickbacks | The separate #286 worker used real Stripe sandbox transport for one synthetic $10 transfer, recovered the same receipt after a deliberately lost response and sent no duplicate. The temporary test key was revoked. This branch does not wire or enable the worker. | Review production funding policy, worker integration, scheduling and bank-payout lifecycle separately. Keep live execution off and external-payment quarantine in place. |

The old manual-review posting proposal is excluded. Native app and AI changes are excluded.
