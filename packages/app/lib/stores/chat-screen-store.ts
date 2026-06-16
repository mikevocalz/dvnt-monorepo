/**
 * Chat Screen State Store
 *
 * Manages chat screen-specific UI state (recipient, loading, group info).
 * Replaces useState calls to comply with project Zustand-only mandate.
 *
 * CRITICAL: This is ephemeral screen state, NOT persisted.
 * State is cleared when navigating away from chat screen.
 */

import { create } from "zustand";

export interface ChatRecipient {
  id: string;
  authId?: string;
  username: string;
  name: string;
  avatar: string;
}

export interface GroupMember {
  id: string;
  authId?: string;
  username: string;
  name?: string;
  avatar?: string;
}

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  senderId?: string;
  time: string;
  readAt?: string | null;
  mentions?: string[];
  media?: any[];
  storyReply?: any;
  sharedPost?: any;
  reactions?: any[];
  status?: "sending" | "sent" | "failed";
  clientMessageId?: string;
}

interface ChatScreenState {
  // Recipient info for 1:1 chats
  recipient: ChatRecipient | null;
  isLoadingRecipient: boolean;

  // Group chat info
  isGroupChat: boolean;
  groupMembers: GroupMember[];
  groupName: string;

  // Mount state machine
  mountPhase: "idle" | "resolving" | "loading" | "ready" | "error";

  // Message action sheet state
  selectedMessage: Message | null;
  showMessageActions: boolean;
  editingMessage: Message | null;
  editText: string;

  // Actions
  setRecipient: (recipient: ChatRecipient | null) => void;
  setIsLoadingRecipient: (loading: boolean) => void;
  setGroupInfo: (
    isGroup: boolean,
    members: GroupMember[],
    name: string,
  ) => void;
  setMountPhase: (phase: ChatScreenState["mountPhase"]) => void;
  setSelectedMessage: (message: Message | null) => void;
  setShowMessageActions: (show: boolean) => void;
  setEditingMessage: (message: Message | null) => void;
  setEditText: (text: string) => void;

  // Reset all state when leaving chat screen
  resetChatScreen: () => void;
}

const initialState = {
  recipient: null,
  isLoadingRecipient: true,
  isGroupChat: false,
  groupMembers: [],
  groupName: "",
  mountPhase: "idle" as const,
  selectedMessage: null,
  showMessageActions: false,
  editingMessage: null,
  editText: "",
};

export const useChatScreenStore = create<ChatScreenState>((set) => ({
  ...initialState,

  setRecipient: (recipient) => set({ recipient }),

  setIsLoadingRecipient: (loading) => set({ isLoadingRecipient: loading }),

  setGroupInfo: (isGroup, members, name) =>
    set({
      isGroupChat: isGroup,
      groupMembers: members,
      groupName: name,
    }),

  setMountPhase: (phase) => set({ mountPhase: phase }),

  setSelectedMessage: (message) => set({ selectedMessage: message }),

  setShowMessageActions: (show) => set({ showMessageActions: show }),

  setEditingMessage: (message) => set({ editingMessage: message }),

  setEditText: (text) => set({ editText: text }),

  resetChatScreen: () => set(initialState),
}));
