# DVNT private event and ticketed Lynk acceptance — E07/E10/T10/S01/S03/S12

**Status:** Acceptance not performed. No real payment, ticket, account, invite, migration or SMS was created.

## User stories
- **E07/E10:** The organizer sees private events; a selected invitee sees only their authorized event; forwarded links, guest browsers and different signed-in accounts are denied without leaking existence/details.
- **T10:** Micah-to-Deviant-DC transfer must reconcile owner, attendee, QR, scanned status, price/currency, fees and Stripe settlement; no irreversible migration on production for QA.
- **S01/S03:** Paid/comp, verified/unverified, private/public, banned, underage and invited/nonbuyer personas must match both web UI and server `video_join_room` / `lynk-moq-token` guards.
- **S12:** Two real clients (web host/native guest and reverse) test camera orientation, mic, chat, waiting until host starts, mute, host-end, background/foreground and offline reconnect. Server must terminate the old session, not just hide its UI.

## Sandbox purchase contract
The existing GitHub `ticket-embed-commerce` real purchase job needs a sandbox event host URL, embed identifier and test buyer email. It must create a **test-mode** Stripe purchase, issue a QR ticket, confirm entitlement/wallet, exercise comp/guest discount and refund, and reconcile amounts without a live charge. Do not replace the checkout backend or manufacture an unverified Stripe success. The job failing from unconfigured secrets is a legitimate blocker.

The file `dvnt-private-events-acceptance.example.json` contains **14 pending cases**. `node scripts/check-dvnt-private-release.cjs --schema-only` proves coverage. Running it with a filled evidence file (without `--schema-only`) fails until every case has `pass`, account-independent test identifiers, dates/build SHA and private evidence URLs.

## Roles/skills
Distinguished payments/entitlements engineer, Staff privacy/AppSec, Principal RTC, QA SDET with two real devices and Product owner. Use Expo/skills, Argent agent-device, Supabase Postgres/RLS, Vercel full-story verification and no-ai-slop. Run independent security check after any code fix.

## Order
1. Create isolated seed personas and sandbox event. 2. Verify permission matrix with negative cases first. 3. Run one real test-mode purchase and comp claim. 4. Run two devices and wallet/QR. 5. Only then consider native OTA or promotion, with explicit approval; this PR never deploys.
