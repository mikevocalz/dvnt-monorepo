// The DVNT Payload config + collections now live in @dvnt/cms — the single
// source of truth shared with apps/web (which runs the admin/REST/console at
// runtime). This app is retained ONLY as the Payload CLI / migration runner:
// it's `"type": "module"` (ESM), the context where Payload v4's ESM-only CLI
// actually works (apps/web is CommonJS — see the @dvnt/cms README / memory).
//
// So this file just re-exports the shared config. Run migrations here:
//   pnpm --filter web-vite migrate
export { default } from '@dvnt/cms'
