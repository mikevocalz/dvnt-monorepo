/**
 * MMKV Storage adapter for Zustand persist middleware
 * Uses react-native-mmkv (synchronous) — NEVER AsyncStorage
 */
import { createMMKV } from "react-native-mmkv";
import { createJSONStorage } from "zustand/middleware";

export const mmkv = createMMKV({ id: "zustand-persist" });

// Synchronous MMKV adapter — eliminates async hydration race conditions
export const mmkvStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    return mmkv.getString(name) ?? null;
  },
  setItem: (name: string, value: string): void => {
    mmkv.set(name, value);
  },
  removeItem: (name: string): void => {
    mmkv.remove(name);
  },
}));
