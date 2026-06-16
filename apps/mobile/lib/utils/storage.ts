import { Platform } from "react-native";
import type { StateStorage } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";

let mmkv: ReturnType<typeof createMMKV> | null = null;

try {
  if (Platform.OS !== "web") {
    mmkv = createMMKV({ id: "dvnt-storage" });
  }
} catch (error) {
  console.error("[Storage] Failed to initialize MMKV:", error);
}

// Storage keys that contain user-specific data and should be cleared on logout/user switch
const USER_DATA_STORAGE_KEYS = [
  "post-storage", // liked posts, like counts
  "bookmark-storage", // bookmarked posts
  "chat-storage", // chat data
  "cart-storage", // checkout cart state + active payment intent
  "lynk-history-storage", // sneaky lynk room history (daily)
  // Don't clear auth-storage here - that's handled separately by clearAuthStorage
  // Don't clear app-storage - that's app state not user data
];

// Clear all user-specific data from storage
export function clearUserDataFromStorage(): void {
  console.log("[Storage] Clearing all user-specific data from storage");
  try {
    if (Platform.OS === "web") {
      USER_DATA_STORAGE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
      });
    } else if (mmkv) {
      USER_DATA_STORAGE_KEYS.forEach((key) => {
        // MMKV v4 API: use remove() not delete()
        mmkv!.remove(key);
      });
    }
    console.log("[Storage] User data cleared successfully");
  } catch (error) {
    console.error("[Storage] Error clearing user data:", error);
  }
}

// Clear auth storage specifically - called during signOut
export function clearAuthStorage(): void {
  console.log("[Storage] Clearing auth storage");
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem("auth-storage");
    } else if (mmkv) {
      // MMKV v4 API: use remove() not delete()
      mmkv.remove("auth-storage");
    }
    console.log("[Storage] Auth storage cleared successfully");
  } catch (error) {
    console.error("[Storage] Error clearing auth storage:", error);
  }
}

export const storage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      if (Platform.OS === "web") {
        return localStorage.getItem(name);
      }
      if (!mmkv) return null;
      return mmkv.getString(name) ?? null;
    } catch (error) {
      console.error("[Storage] Error getting item:", error);
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      if (Platform.OS === "web") {
        localStorage.setItem(name, value);
      } else {
        if (mmkv) {
          mmkv.set(name, value);
        }
      }
    } catch (error) {
      console.error("[Storage] Error setting item:", error);
    }
  },
  removeItem: (name: string): void => {
    try {
      if (Platform.OS === "web") {
        localStorage.removeItem(name);
      } else {
        if (mmkv) {
          mmkv.remove(name);
        }
      }
    } catch (error) {
      console.error("[Storage] Error removing item:", error);
    }
  },
};
