import { create } from "zustand";

/**
 * Comment composer draft (web post detail). Per project rule, input state lives
 * in Zustand, not React useState. One composer is open at a time, so a single
 * draft + optional reply target is sufficient.
 */
interface CommentDraftState {
  /** The composer is hidden until the user taps the comment button / a Reply. */
  open: boolean;
  text: string;
  replyTo: { commentId: string; username: string } | null;
  setOpen: (open: boolean) => void;
  openComposer: (replyTo?: CommentDraftState["replyTo"]) => void;
  setText: (text: string) => void;
  setReplyTo: (target: CommentDraftState["replyTo"]) => void;
  reset: () => void;
}

export const useCommentDraftStore = create<CommentDraftState>((set) => ({
  open: false,
  text: "",
  replyTo: null,
  setOpen: (open) => set({ open }),
  openComposer: (replyTo = null) => set({ open: true, replyTo }),
  setText: (text) => set({ text }),
  setReplyTo: (replyTo) => set({ replyTo, open: true }),
  reset: () => set({ text: "", replyTo: null, open: false }),
}));
