# Lynk header and reactions correction

## Report and cause

The supplied mobile Chrome screenshot shows the released web room still using two intentional responsive layouts: header actions wrap onto a centered second row below the title, and portrait viewports keep the emoji palette permanently above the dock. The prior geometry regression proved controls were reachable, but did not assert the requested single-row composition. This correction changes those production components and strengthens that regression.

## Changes

- One header row at all widths. The title truncates; Share and Participants stay directly on the right. Narrow hosts get a labelled Room actions overflow for raised hands, Mute everyone, and Let everyone unmute. Essential controls remain at least 44px.
- Host status and the final-minute timer remain visible. A compact timer variant avoids conflicting Tailwind spacing defaults without changing countdown or media-stop behavior.
- One bottom Reactions toggle at every viewport size. Its six-button palette opens over the stage and closes on selection, toggle, Escape, outside tap, focus departure, or another room panel. Selection/Escape restore toggle focus.
- Both popovers preserve media ownership. Header overflow stays inside the protected room DOM, above disclosure/sticky video layers; floating emoji no longer paint over the dock/picker.
- Roster readiness, camera/privacy behavior, native controls, backend admission, and media orientation logic are unchanged.

## Verification

- 56 rendered Chromium cases passed using real production React components and generated Tailwind: host/participant layouts across ten viewport sizes; 1/2/12/20-person stages; safe areas; 393×852 layout viewport with 560–730px visible Chrome-style viewport; keyboard shrink/pan; privacy notice changes; room actions; reactions; chat; roster recovery; time-limit dialog; native stage/dock through React Native Web. Service/media/device boundaries are fixtures; no live room or camera was used.
- The tests now assert one 44px header action row, exactly one reaction toggle and no permanent emoji row, menu/picker geometry and hit targets, real action handlers, dismissal/focus behavior, and unchanged canvas attachment counts.
- 178 Lynk/timer/connection unit tests passed. Native media lifecycle fixture, `verify-lynk`, release regression gate, focused strict header/timer TypeScript, and changed-file hooks lint passed (four pre-existing unused-disable warnings in the room screen).
- Full web TypeScript was attempted against this tree and the unchanged baseline: both report the same 229 diagnostic lines, primarily missing local workspace aliases and dependent existing errors; zero newly introduced diagnostics after normalizing paths/line numbers. A clean full-app typecheck/build is not claimed.
- Independent review exercised additional nine-point hit tests, queue/panel transitions, focus restoration, visual viewport pan, portrait/landscape resizing, and stable media attachment ownership.
- Physical iPhone/WebKit validation is not claimed. The available WebKit runtime could not launch because required system libraries were absent.

## Running the rendered regression

Run `node scripts/test-lynk-layout-browser.cjs` with the isolated dependencies listed in `.github/workflows/lynk-layout-regressions.yml` and Playwright-managed Chromium installed. Set `LYNK_LAYOUT_OUTPUT` to retain evidence screenshots. Optional `LYNK_LAYOUT_CASES` and `LYNK_LAYOUT_SUITES` comma-separated filters support focused reruns; CI runs the full suite by default. The workflow now also watches RoomTimer changes.
