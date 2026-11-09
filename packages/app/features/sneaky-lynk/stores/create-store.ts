/**
 * Tiny form Zustand store for the WEB "Create Lynk" screen.
 *
 * The native screen kept this in local `useState`; the web HARD CONVENTION is
 * Zustand only (no useState). Holds the create-room form draft + the invitee
 * search input and selection. Query owns search results. `reset()` clears the
 * draft when this screen unmounts.
 */

import { create } from "zustand";

export interface LynkInvitee {
  id: string;
  authId: string;
  username: string;
  avatar: string;
}

interface CreateLynkStore {
  title: string;
  description: string;
  hasVideo: boolean;
  isPublic: boolean;
  /** App-only room — web viewers can't join. The only enforced tier of
   *  capture protection (see `video_join_room`'s app-only gate). */
  appOnly: boolean;
  isCreating: boolean;
  createError: string | null;
  inviteSearch: string;
  invitees: LynkInvitee[];

  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setHasVideo: (v: boolean) => void;
  setIsPublic: (v: boolean) => void;
  setAppOnly: (v: boolean) => void;
  setIsCreating: (v: boolean) => void;
  setCreateError: (v: string | null) => void;
  setInviteSearch: (v: string) => void;
  addInvitee: (user: LynkInvitee) => void;
  removeInvitee: (authId: string) => void;
  reset: () => void;
}

export const useCreateLynkStore = create<CreateLynkStore>((set) => ({
  title: "",
  description: "",
  hasVideo: false,
  isPublic: true,
  appOnly: false,
  isCreating: false,
  createError: null,
  inviteSearch: "",
  invitees: [],

  setTitle: (title) => set({ title }),
  setDescription: (description) => set({ description }),
  setHasVideo: (hasVideo) => set({ hasVideo }),
  setIsPublic: (isPublic) => set({ isPublic }),
  setAppOnly: (appOnly) => set({ appOnly }),
  setIsCreating: (isCreating) => set({ isCreating }),
  setCreateError: (createError) => set({ createError }),
  setInviteSearch: (inviteSearch) => set({ inviteSearch }),
  addInvitee: (user) =>
    set((state) =>
      state.invitees.some((i) => i.authId === user.authId)
        ? { inviteSearch: "" }
        : {
            invitees: [...state.invitees, user],
            inviteSearch: "",
          },
    ),
  removeInvitee: (authId) =>
    set((state) => ({
      invitees: state.invitees.filter((i) => i.authId !== authId),
    })),
  reset: () =>
    set({
      title: "",
      description: "",
      hasVideo: false,
      isPublic: true,
      appOnly: false,
      isCreating: false,
      createError: null,
      inviteSearch: "",
      invitees: [],
    }),
}));
