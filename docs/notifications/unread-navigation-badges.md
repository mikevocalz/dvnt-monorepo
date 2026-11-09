# Unread navigation badges — draft release evidence

## Scope and semantics

- Activity: exact unread notification count across all rows, not the loaded first page. Shown on native Activity tab, mobile-web tabbar, desktop/collapsed rail.
- Messages: unread **conversations** in Inbox; Requests, blocked directs and outgoing-only/read threads are excluded. Group conversations remain Inbox. Shown on native header, mobile-web header, desktop/collapsed rail and legacy design header.
- Zero hides; 1–99 stays exact; overflow displays `99+`. Web/header accessible names announce the full count. Native tabs use the platform badge. The decorative pill does not duplicate announcements or scale beyond its fixed container.
- Only viewer-keyed TanStack counts drive navigation. Push/realtime deliveries are refresh hints, never arithmetic increments. Shared subscriptions deduplicate observers; INSERT/UPDATE/DELETE, subscribed/reconnect, focus and a 30-second foreground fallback refresh the counts.
- A failed read preserves the last confirmed count. Account-key guards reject delayed prefetch and in-flight A→B→A responses. Legacy/boot aggregate totals cannot overwrite the canonical message count.
- Message existence reads are bounded to four in flight; metadata is paginated in 200-row pages. One busy thread with >1000 messages cannot hide another thread. Canonical conversation IDs make local confirmed-read reconciliation exact/idempotent; orphan participants do not freeze unrelated totals.

## Release pairing

Pair with [Activity reliability PR #216](https://github.com/mikevocalz/dvnt-monorepo/pull/216): canonical Activity header, read/read-all persistence/rollback/invalidation, bootstrap count-shape fix, history and list freshness. That PR is the Activity mutation dependency; the badge PR owns chrome, count queries and delayed prefetch boundaries. Integrate Activity first, then badges, rerun both suites; neither draft is authorization to merge or deploy.

No schema, publication, RLS, edge deployment, credential or live data/read-state change is part of this patch. Native needs a compatible mobile release/OTA per the project's release policy; web needs the normal authorized web release. Realtime publication availability is not assumed; foreground polling remains required.

## Local evidence

Passed using only public synthetic fixtures:

- Count/formatting: large history, metadata page boundaries, Inbox/Requests/groups/blocks/own/read messages, errors, orphan participants and cap/zero labels.
- Real React + TanStack Query + RN Web mounted DOM: actual AppShell/mobile header/tabbar, desktop/collapsed rail; native tab/header contract with platform component mocks. Repeated incoming/read, reconnect/focus/foreground polling, errors, account switch/logout, accessible labels, stable focus and navigation.
- Actual notification API count contract, and native push hook mounted **outside** QueryClientProvider (the real root architecture); no per-message increments.
- Viewer-scoped helper: wrong-key rejection before fetch, A→B→A, abort, listener cleanup, delayed-lane cleanup and bootstrap exclusion.
- Focused TypeScript with real TanStack/Supabase types and typed external app boundaries; Rules of Hooks lint. Three existing inline-lint directive warnings are not hook errors.
- Existing chrome parity, web-chrome routing, message realtime, route resolver, release-regression and no-live-identifiers checks.

Not claimed as locally passed:

- Full workspace app lint/typecheck: dependencies absent; pnpm bootstrap failed creating its unavailable home store. Focused checks are not a full app build.
- Real Chromium visual check: sandbox denied Chromium's local socket; escalation then failed in the environment's read-only sessions mount. No permission bypass attempted. The same browser harness is wired into isolated CI and uploads synthetic screenshots.
- Native simulator/device rendering, accessibility font/screen reader verification or live authenticated end-to-end behavior. Native runtime fixtures verify wiring, not device pixels.
