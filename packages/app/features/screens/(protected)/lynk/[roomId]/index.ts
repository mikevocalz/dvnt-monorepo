// TypeScript-resolution fallback for the dir import. Metro/Next override this
// with index.native.tsx (mobile) / index.web.tsx (web) at build time.
export { default } from "./native";
