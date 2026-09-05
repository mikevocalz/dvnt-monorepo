# Project Environment

Environment inspected 2026-09-05 for native watch v2 work. Authoritative inspector result: [docs/watch-v2-environment.json](docs/watch-v2-environment.json). Native companions are SwiftUI watchOS and Kotlin Wear; phone is Expo/React Native. Existing generated iOS changes predate this task and must be preserved.

Native watch target builds with signing disabled against watchsimulator26.4; no eligible running watch simulator or paired watch was available. Wear isolated debug and unsigned release builds pass using JDK17; full phone Gradle attempt hit disk exhaustion. Exact evidence lives in `docs/watch-v2-*-evidence.md`.

Never infer runtime, physical QR/audio, notifications/background, or performance validation from compiler success. No production migrations, deployment, push or merge authorized for this work.

Latest continuation: consolidated implementation/verification/dependency matrix is `docs/watch-v2/release-status.md`. Host aggregate sync, Wear tiles/complications/background call actions and Ongoing Activity now compile. Shared final regression suite: 50 tests; Wear: 15 tests; phone TypeScript passes. Call notification/CallKit/overlay decisions are recipient-bound and backend-confirmed. Release remains incomplete; consult the matrix before claiming completion.
