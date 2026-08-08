/**
 * Tiny form Zustand store for the WEB "Create Lynk" screen.
 *
 * The native screen kept this in local `useState`; the web HARD CONVENTION is
 * Zustand only (no useState). Holds the create-room form draft + the invitee
 * search/selection state. `reset()` clears it on a successful create.
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
  isCreating: boolean;
  inviteSearch: string;
  inviteResults: LynkInvitee[];
  invitees: LynkInvitee[];

  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setHasVideo: (v: boolean) => void;
  setIsPublic: (v: boolean) => void;
  setIsCreating: (v: boolean) => void;
  setInviteSearch: (v: string) => void;
  setInviteResults: (v: LynkInvitee[]) => void;
  addInvitee: (user: LynkInvitee) => void;
  removeInvitee: (authId: string) => void;
  reset: () => void;
}

export const useCreateLynkStore = create<CreateLynkStore>((set) => ({
  title: "",
  description: "",
  hasVideo: false,
  isPublic: true,
  isCreating: false,
  inviteSearch: "",
  inviteResults: [],
  invitees: [],

  setTitle: (title) => set({ title }),
  setDescription: (description) => set({ description }),
  setHasVideo: (hasVideo) => set({ hasVideo }),
  setIsPublic: (isPublic) => set({ isPublic }),
  setIsCreating: (isCreating) => set({ isCreating }),
  setInviteSearch: (inviteSearch) => set({ inviteSearch }),
  setInviteResults: (inviteResults) => set({ inviteResults }),
  addInvitee: (user) =>
    set((state) =>
      state.invitees.some((i) => i.authId === user.authId)
        ? { inviteSearch: "", inviteResults: [] }
        : {
            invitees: [...state.invitees, user],
            inviteSearch: "",
            inviteResults: [],
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
      isCreating: false,
      inviteSearch: "",
      inviteResults: [],
      invitees: [],
    }),
}));
