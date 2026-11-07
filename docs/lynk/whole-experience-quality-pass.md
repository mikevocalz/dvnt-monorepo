# Whole-experience quality pass

## Discovery and creation

- Shared account-scoped discovery preserves useful cached rooms during refresh failure and exposes retry. Missing or incomplete presence does not prove an open room ended. Uncertain availability remains enterable for an authoritative admission check.
- Cards distinguish public/private, audio/video, known capacity and ended/open state. Long titles, loading, empty and failure states have responsive layouts.
- Creation submits the selected private invitees on native as well as web, requires a confirmed server room ID, retains drafts after failure, prevents duplicate submission and guards account/navigation ownership.
- Invite search is cancellable and has real loading, empty, error and retry states. Existing plan limits and verified-account rules remain authoritative.

## Invitations and arrival

- Native and web offer durable co-host invitation cards with explicit Accept & review and Decline, shared pending locks and retryable errors. Dismissing a toast does not decline an invitation.
- Account changes, including A→B→A, cannot reuse obsolete invitation responses or creation/entry intent. Notification routing leads to the explicit invitation decision.
- Every server room, including hosts and accepted co-hosts, uses media review. URL flags do not grant device consent or authority.
- Prejoin reads only the caller's own existing membership through the privacy-safe roster RPC. Active named/anonymous identity is displayed accurately rather than offering a choice the server would ignore.
- Back, navigation, changed review choices and obsolete verification callbacks invalidate pending entry. Lookup has bounded failure/retry states. Native camera and microphone begin off.

## Sharing and lifecycle

- Private link copy explains that access is still required. Sharing a URL does not grant access. Repeated share taps are single-flight; dismissing a sheet is quiet; leaving invalidates fallback clipboard work and stale feedback.
- Going back from prejoin does not silently end an already-created room or remove an existing membership that may be active on another device. This is stated in the active-membership panel. Existing server invitation acceptance creates membership before media review; that policy is unchanged.
- Host/co-host moderation, searchable 30-person rosters, shared pending states, expiring confirmations and current-role departure are covered by the prior host/guest increment.

## Evidence and limits

Production React components and hooks are exercised with service/media boundaries adapted. Browser fixtures cover phone, landscape and desktop; discovery and creation were rendered at 320, 393 and 1280 pixels with long labels and real icons. Automated checks include interrupted/repeated actions, identity isolation, delayed responses and uncertain discovery presence. Exact source snapshot and CI results are recorded on PR #250.

No merge, production deployment, backend policy migration or live invitation mutation is part of this work. Physical iOS/Android, Safari, Bluetooth, actual audibility, authenticated multi-device reconnect and true 10–30-person concurrent call performance remain deferred. These checks do not establish competitive parity or superiority over Batemate, Sniffies or meeting apps.
