import { create } from "zustand";

/**
 * Comment composer draft (web post detail). Per project rule, input state lives
 * in Zustand, not React useState. One composer is open at a time, so a single
 * draft + optional reply target is sufficient.
 */
interface CommentDraftState {
  /** The composer is hidden until the user taps the comment button / a Reply. */
  open: boolean;
  context: string | null;
  revision: number;
  bindContext: (context: string) => void;
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
  context: null,
  revision: 0,
  bindContext: (context) => set((state) => state.context === context ? state : {
    context, revision: state.revision + 1,
    ...(state.context === null ? {} : { open: false, text: "", replyTo: null }),
  }),
  text: "",
  replyTo: null,
  setOpen: (open) => set((state) => ({ open, revision: state.revision + 1 })),
  openComposer: (replyTo = null) => set((state) => ({ open: true, replyTo, revision: state.revision + 1 })),
  setText: (text) => set((state) => ({ text, revision: state.revision + 1 })),
  setReplyTo: (replyTo) => set((state) => ({ replyTo, open: true, revision: state.revision + 1 })),
  reset: () => set((state) => ({ text: "", replyTo: null, open: false, revision: state.revision + 1 })),
}));
