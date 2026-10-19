# App-assisted Live Photo import for a web draft

Status: draft implementation, not deployed or device-accepted.

This is an explicitly app-assisted workflow. It does not make the browser's file input extract Apple's paired resource. A supported installed DVNT iOS app is required. Existing web upload remains unchanged unless `NEXT_PUBLIC_ENABLE_NATIVE_LIVE_PHOTO_HANDOFF=true` is set at build time.

## Flow

1. The signed-in browser snapshots the complete current composer, including original Blob bytes, into IndexedDB. Storage denial or quota failure prevents opening the app. One outstanding backup per account is protected by draft-ID compare-and-swap, not overwritten by another tab.
2. The existing Supabase backend creates a 15-minute owner-bound handoff, with the remaining 10-item capacity. The browser stores its random draft ID and stable consume request ID before presenting the `dvnt://live-photo-handoff` link. These UUIDs are not authorization; every API call requires the same authenticated account.
3. A user gesture opens the installed app. Existing deep-link authentication replay preserves both UUIDs. The member explicitly selects Live Photos. The app uploads original still and motion resources through the existing media-upload/Bunny pipeline. Successful half uploads are retained in memory on retry; no still-only success is reported.
4. Completion validates service-only upload receipts, ownership, media type and immutable source details for every pair. All pairs become ready in a single transaction, or none do.
5. The member switches back to the ORIGINAL browser tab. Foreground polling discovers completion. Restoring adds ordered Live Photos to the saved draft without publishing. A changed current draft requires explicit replacement confirmation; further edits during asynchronous restore abort the replacement. The existing post queue reuses these uploads for the same owner.
6. Share remains disabled while the pickup is unresolved. Cancel does not change the current composer. Expired pickups can be locally discarded; the original snapshot can be restored separately. After restore, the member reviews and chooses Share explicitly.

## Return behavior and limitations

We do not claim that iOS can return to a specific Chrome/Safari tab. A universal-link Return button can reopen the app, and the OS default browser may differ from the originating browser. The native screen therefore instructs switching to the original tab; it does not claim automatic return. Another browser has different origin storage and cannot recover that browser's local draft.

No installed-app detection is asserted. If the custom link is unavailable, the browser retains the saved draft and offers cancellation. Native selection is iOS-only; Android receives an honest unsupported message.

Original browser backups are retained locally for up to 24 hours, keyed by owner. Account reset clears them. The handoff expires after 15 minutes. The server must not expose handoff or receipt tables directly to anon/authenticated clients. A same-request consume retry returns the same result after a lost response; a different request ID is rejected. Deterministic media IDs prevent duplicate insertion into a draft.

## Required deployment order (separate authorization)

1. Review and approve `20261019213000_live_photo_handoff.sql`. Apply it to the existing Supabase backend; it adds service-only handoff and upload-receipt tables/RPC, not a second backend. No live migration has been run by this implementation.
2. Deploy updated `media-upload`. It requires the receipt table and intentionally refuses success if receipt storage fails. Do NOT deploy this uploader before the migration.
3. Deploy `live-photo-handoff` with the checked-in config. Verify unauthenticated/cross-account/expired/replay rejection using controlled test accounts.
4. Verify the installed native release's channel/runtime/build. Ship the native route through a compatible OTA only if runtime compatibility is established; otherwise a new app build is required. No Expo credential, release, or runtime assumption is made here.
5. Enable the web feature flag only after backend and compatible native delivery. Refresh and verify the production bundle.
6. On a physical iPhone test both cold and warm app launch, sign-in interruption, multiple Live Photos, partial upload retry, 10-item cap/rate limit, return to original Safari and Chrome tabs, autoplay of the active slide, account changes, private browsing, storage quota failure and reload recovery. Existing static posts cannot gain motion that was never uploaded.

## Tests

- `node scripts/test-native-live-photo-handoff.cjs`
- `node scripts/test-web-live-photo-handoff.cjs`
- `node --test packages/app/features/create/live-photo-handoff-draft.test.ts`
- `node --max-old-space-size=256 --wasm-lazy-compilation --liftoff-only apps/mobile/supabase/functions/_shared/live-photo-handoff.contract.cjs`
- Existing unified composer/publish tests and the Feed media motion CI workflow.

Tests use isolated files/DB and controlled auth/storage adapters. They are not evidence of production upload, native PhotoKit decoding, physical browser return, or a release installed on a user's phone.
