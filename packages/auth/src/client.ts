// Base entry — re-exports the web client (PROMPT 0 §3). Platform resolution is
// handled by the package `exports` map (native → client.native.ts, web →
// client.web.ts); this is the non-conditional default.
export * from "./client.web";
