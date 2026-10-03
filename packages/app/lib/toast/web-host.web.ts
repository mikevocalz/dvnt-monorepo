import { toast } from "sonner";
import type { ToastApi } from "./dispatch.ts";

/**
 * Web: Next mounts sonner's <Toaster> (apps/web/src/components/web-toaster.tsx),
 * not sonner-native's, so sonner-native's toast throws there. This is the host
 * that actually renders on web.
 */
export const webToastHost: ToastApi | null = toast;
