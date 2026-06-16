/**
 * OtaUpdateBanner — no-op shell.
 * OTA update prompts are now handled via sonner-native toast in use-updates.ts.
 * This file is kept to avoid modifying _layout.tsx imports.
 */
export function OtaUpdateBanner() {
  return null;
}
