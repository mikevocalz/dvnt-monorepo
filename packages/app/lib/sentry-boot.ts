/**
 * Sentry boot — WEB/no-op fork. The Next app initializes Sentry through its
 * own instrumentation files; the shared root layout must not double-init.
 * Real implementation: sentry-boot.native.ts (Metro resolves it on device).
 */
export const Sentry = undefined;

export function bootSentry(): void {}

export function wrapRoot<T>(component: T): T {
  return component;
}
