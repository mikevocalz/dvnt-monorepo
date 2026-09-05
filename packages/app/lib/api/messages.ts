/**
 * Messages API - Re-exports from implementation
 */
export { messagesApi, messagesApi as messagesApiClient } from "./messages-impl";

// Conversation type for messages list
export interface Conversation {
  id: string;
  user: {
    id: string;
    authId?: string;
    name: string;
    username: string;
    avatar: string;
  };
  lastMessage: string;
  timestamp: string;
  createdAt?: string;
  lastMessageId?: string;
  lastSenderId?: string;
  lastMessageMetadata?: Record<string, unknown> | null;
  category?: "inbox" | "request" | "spam";
  unread: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: Array<{
    id: string;
    authId: string;
    username: string;
    avatar: string;
  }>;
}

export interface ThreadCursor { createdAt: string; id: string }
export interface ThreadMessage {
  id: string; text: string; sender: string; senderId: string;
  timestamp: string; createdAt: string; readAt: string | null;
  metadata: Record<string, unknown> | null;
}
export interface ThreadPage {
  conversationId: string; messages: ThreadMessage[]; olderCursor?: ThreadCursor;
}
