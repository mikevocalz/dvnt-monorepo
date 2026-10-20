import { create } from "zustand";
import type { SharedPostContext } from "./chat-store";

/** Web-only overlay selection. Conversation/message data stay in their existing stores. */
export const useWebPostShareStore = create<{
  post: SharedPostContext | null;
  open: (post: SharedPostContext) => void;
  close: () => void;
}>((set) => ({
  post: null,
  open: (post) => set({ post }),
  close: () => set({ post: null }),
}));
