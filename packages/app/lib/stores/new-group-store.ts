import { create } from "zustand";

export interface NewGroupSelectedUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

interface NewGroupState {
  searchQuery: string;
  groupName: string;
  selectedUsers: NewGroupSelectedUser[];
  isCreating: boolean;
  setIsCreating: (value: boolean) => void;
  setSearchQuery: (query: string) => void;
  setGroupName: (name: string) => void;
  toggleUser: (user: NewGroupSelectedUser, max?: number) => boolean;
  removeUser: (id: string) => void;
  isSelected: (id: string) => boolean;
  reset: () => void;
}

/**
 * Tiny Zustand store backing the New Group screen — search query, group name,
 * and the selected-members set (Law: state is Zustand, never useState).
 * A caller can supply its own domain limit; group chats do not inherit the audio-call cap.
 */
export const useNewGroupStore = create<NewGroupState>((set, get) => ({
  searchQuery: "",
  groupName: "",
  selectedUsers: [],
  isCreating: false,
  setIsCreating: (value) => set({ isCreating: value }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setGroupName: (name) => set({ groupName: name }),
  toggleUser: (user, max) => {
    const prev = get().selectedUsers;
    const exists = prev.some((u) => u.id === user.id);
    if (exists) {
      set({ selectedUsers: prev.filter((u) => u.id !== user.id) });
      return true;
    }
    if (max !== undefined && prev.length >= max - 1) {
      return false;
    }
    set({ selectedUsers: [...prev, user] });
    return true;
  },
  removeUser: (id) =>
    set((state) => ({
      selectedUsers: state.selectedUsers.filter((u) => u.id !== id),
    })),
  isSelected: (id) => get().selectedUsers.some((u) => u.id === id),
  reset: () => set({ searchQuery: "", groupName: "", selectedUsers: [], isCreating: false }),
}));
