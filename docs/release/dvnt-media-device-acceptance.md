# DVNT media and stories device acceptance (P06/P10/S05/S10)

`P06`: video and flyer uploads (small, large, post, story and event) complete beyond the historical 10% stall; an aborted upload is retryable and does not falsely show success. `P10`: tap the story creator avatar/name on iOS/Android/web and navigate to the correct **other** or **own** profile (including renamed handles). `S05`: host Mute All affects real remote publisher audio, cannot be self-unmuted until released, and release does not start the microphone. `S10`: demonstrate actual iOS foreground capture behavior, Android FLAG_SECURE and browser deterrence limitations (do not promise screenshot prevention on the web).

The schema in `dvnt-media-device-acceptance.example.json` is **entirely PENDING**. A pass requires actual device/build/OS/tester/timestamp and a reproducible screenshot, sanitized log or recording evidence URL. Do not fill in fake passes. Run `node scripts/check-dvnt-device-evidence.cjs <evidence-file.json>` to make acceptance fail closed; `--schema-only` tests only that the plan covers every required case.

Existing unit tests are `packages/app/lib/profile/story-profile-path.test.ts`, `packages/app/lib/media/upload-policy.test.ts` and `packages/app/lib/video/host-mute.test.ts`. They are regressions, not physical-device verification. Capture permission denied/regrant, background/foreground, mobile data loss, iPad and foldable when supported. Use Expo/skills, Argent agent-device, React best practices and Impeccable for UI; no UI redesign until observed evidence shows one is needed.

No native OTA/store release or production upload action is authorized by this draft.
