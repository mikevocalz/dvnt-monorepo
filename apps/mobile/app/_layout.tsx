// FIRST import in the mobile graph, deliberately: it silences release-build
// console.log before any other module can start writing through NSLog.
// See the file for the watchdog crash this addresses.
import "@dvnt/app/lib/silence-production-logs";

// The app owns its stylesheet. This must be the ONLY global.css in the mobile
// graph: `packages/app/features/routes/global.css` used to be imported here
// instead, and it was a stub with no `@source` and no `@theme` — so Tailwind
// scanned nothing, emitted zero utilities, and every `className` colour was
// silently inert while inline styles kept working. That is what made screens
// fall through to the OS light-mode container background.
import "../global.css";

export * from '@dvnt/app/features/routes/screens/_layout';
export { default } from '@dvnt/app/features/routes/screens/_layout';
