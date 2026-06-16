// Base entry — re-exports the web client (mirrors @dvnt/supabase). Platform
// resolution is handled by the package `exports` map: native bundlers pick
// client.native.ts, web/Vite picks client.web.ts; this file is the
// non-conditional default (tooling, SSR type resolution).
export * from "./client.web";
