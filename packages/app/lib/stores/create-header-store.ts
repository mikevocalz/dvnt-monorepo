import { create } from "zustand";

/**
 * The Create tab's header actions, published to the layout.
 *
 * Every other tab draws its header in the Stack header slot, which sits ABOVE
 * the tab bar. Create used to opt out of that slot (`TabsHeader` returned null
 * for it) and draw its own bar inside the screen instead, so its header landed
 * BELOW the tabs — a different position from every sibling, most obvious on
 * iPad where the tab bar is at the top.
 *
 * Close and Post are screen state, so the layout cannot compute them; the
 * screen registers them here on mount and the header reads them. Deliberately
 * NOT persisted — these are live callbacks, meaningless across a launch.
 */
interface CreateHeaderState {
  /** Post is enabled — the composer has valid content and nothing is in flight. */
  canPost: boolean;
  /** Label for the action, so the screen owns its own wording ("Posting…"). */
  postLabel: string;
  onClose: (() => void) | null;
  onPost: (() => void) | null;
  register: (
    actions: Partial<Omit<CreateHeaderState, "register" | "reset">>,
  ) => void;
  reset: () => void;
}

const EMPTY = {
  canPost: false,
  postLabel: "Post",
  onClose: null,
  onPost: null,
} as const;

export const useCreateHeaderStore = create<CreateHeaderState>((set) => ({
  ...EMPTY,
  register: (actions) => set(actions),
  reset: () => set({ ...EMPTY }),
}));
