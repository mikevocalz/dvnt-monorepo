/**
 * Toast fan-out for useUIStore.showToast. Each host is a toast API that may
 * throw when its <Toaster> is not mounted in the current tree (sonner-native
 * throws "ToastContext is not initialized"). The first host that accepts the
 * toast wins. Never throws: a toast must not break its caller.
 */
export type ToastType = "success" | "error" | "warning" | "info";
type ToastFn = (title: string, options?: { description?: string }) => unknown;
export type ToastApi = Record<ToastType, ToastFn>;

export function dispatchToast(
  hosts: ReadonlyArray<ToastApi | null>,
  type: ToastType,
  title: string,
  description?: string,
): boolean {
  for (const host of hosts) {
    if (!host) continue;
    try {
      host[type](title, { description });
      return true;
    } catch {
      // This host's Toaster is not mounted here; try the next one.
    }
  }
  return false;
}
