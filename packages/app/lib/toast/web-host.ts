import type { ToastApi } from "./dispatch.ts";

/** Native: sonner-native is the only toast host, so there is no second one. */
export const webToastHost: ToastApi | null = null;
