// Base entry — re-exports the web client (PROMPT 0 §3). Platform resolution is
// handled by the package `exports` map: native bundlers pick client.native.ts,
// web/Vite picks client.web.ts; this file is the non-conditional default.
export * from "./client.web";
