# 03 — Tokens

Every colour, size and timing the door scanner uses, and where it comes from.

## Verdict semantics — fixed

| Verdict | Meaning | Background | Foreground | Glyph | First word |
|---|---|---|---|---|---|
| Admitted | server said yes | `rgba(34,197,94,0.95)` | `#FFFFFF` | CheckCircle2 | **Admitted** |
| Rejected | **the server** said no | `rgba(244,63,94,0.95)` | `#FFFFFF` | XCircle | the reason |
| Duplicate | rejected, loud variant | `#FC253A` full-viewport | `#FFFFFF` | AlertTriangle | **Already scanned** |
| No verdict | we never got an answer | `#FEF3C7` | `#78350F` | AlertTriangle | **Not checked in** |

Measured contrast, not estimated:

| Pair | Ratio | Verdict |
|---|---|---|
| `#78350F` on `#FEF3C7` (amber title) | **8.15:1** | passes AA and AAA |
| amber body at 85% opacity | **5.56:1** | passes AA |
| `#FFFFFF` on `#D97706` — **the version this replaced** | **3.19:1** | fails AA for body text |

Amber is dark-on-light rather than light-on-dark (`#FFFBEB` on `#7C2D12`, ~9:1)
because a door reads this at arm's length in the dark: a pale field is findable
across a queue, a dark brown one is not.

Colour is never alone. Each verdict carries a colour, a glyph and a first word,
and any two must be enough — the reason a no-verdict stopped sharing `XCircle`
with a rejection.

## Surface

| Token | Value | Where |
|---|---|---|
| Screen background | `#06070d` | scanner root |
| Card surface | `bg-white/6`, `border-white/8` | manual entry, progress, recent scans |
| Row divider | `border-white/8` | guest list rows |
| Accent (primary action) | `#3FDCFF` | Allow camera, check-in submit |
| Purple (brand) | `#8A40CF` | not used on this screen — the door has no brand moment |

## Type

Four sizes. Hierarchy comes from weight and colour before size.

| Role | Size / weight |
|---|---|
| Verdict title | 22px / 700 (duplicate: 28px / 700, uppercase) |
| Screen title | 17px / 600 |
| Row name, body | 15px / 500 |
| Secondary, metadata | 12–13px / 400–600 |
| Original check-in time (duplicate card) | 40px / 700 mono |

The duplicate card's time is the largest number on any screen here on purpose:
it is the fact that settles an argument at the door.

## Targets and spacing

- **44px minimum** on every control. WCAG 2.2 AA's floor is 24px; this is not a
  door standard, and one-handed use in the dark is why.
- Guest list rows are **56px minimum**, full-row hit area.
- ≥8px between adjacent controls.
- Spacing on Tailwind's 4px scale throughout — no one-off values.

## Timings — as built

| Thing | Value | Source |
|---|---|---|
| expo-camera decode interval | **300ms** | hard-coded, `ExpoCamera.web.tsx:61`; not forkable |
| Scan gate absence window | **1200ms** | `scan-gate.ts`, unit-tested |
| Camera remount after hidden | **>1500ms** | `QrScanner.web.tsx` visibility handler |
| Camera start watchdog | **8s** | surfaces a stall that nothing else reports |
| Track capability probe | **150ms** poll, **4s** ceiling | `onCameraReady` is not a readiness signal on web |
| Offline token refresh | **180s** | brief |
| Offline queue drain | **20s** while queued, plus immediately on `online` | brief |
| Roster staleTime | **30s** | shared by list and progress bar |
| Confirmed-role memory | **24h** | `confirmed-door-role.ts`, unit-tested |
| Duplicate flash animation | **280ms**, disabled under `prefers-reduced-motion` | `dvnt-dup-flash` |

## Hard-coded values removed

The verdict titles were three string literals inside the web screen and three
more inside the native one. They are now one shared `scanVerdictTitle`, which is
what stopped web and native drifting — and what surfaced that `already_scanned`
never reached the mapping at all.
