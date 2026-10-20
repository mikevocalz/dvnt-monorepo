"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Send, Search } from "lucide-react";
import { Drawer } from "@dvnt/ui";
import { UserAvatar } from "@dvnt/app/components/ui/avatar";
import { useConversations } from "@dvnt/app/lib/hooks/use-messages";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";
import { useChatStore } from "@dvnt/app/lib/stores/chat-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useShareSheetStore } from "@dvnt/app/lib/stores/share-sheet-store";
import { useWebPostShareStore } from "@dvnt/app/lib/stores/web-post-share-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import type { Conversation } from "@dvnt/app/lib/api/messages";

/** Web rendering of the native inbox reshare, using its conversation and send services. */
export function ShareToInboxSheet() {
  const post = useWebPostShareStore((s) => s.post);
  // Mount the querying body only while open: no inbox fetch on every feed load.
  return post ? <ShareToInboxBody key={post.postId} /> : null;
}

function ShareToInboxBody() {
  const post = useWebPostShareStore((s) => s.post);
  const close = useWebPostShareStore((s) => s.close);
  const user = useAuthStore((s) => s.user);
  const {
    data: conversations = [],
    isPending,
    isError,
    refetch,
  } = useConversations();
  const query = useShareSheetStore((s) => s.searchQuery);
  const setQuery = useShareSheetStore((s) => s.setSearchQuery);
  const sendingTo = useShareSheetStore((s) => s.sendingTo);
  const setSendingTo = useShareSheetStore((s) => s.setSendingTo);
  const send = useChatStore((s) => s.sendSharedPost);
  const showToast = useUIStore((s) => s.showToast);
  const guardVerified = useVerifiedGate();
  const inFlight = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const viewerId = user?.id;

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = panel.current?.closest('[role="dialog"]');
      const controls = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        ) ?? [],
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      setQuery("");
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [setQuery]);
  const initialViewer = useRef(viewerId);
  useEffect(() => {
    if (initialViewer.current !== viewerId) close();
  }, [viewerId, close]);

  const handleSend = (conversation: Conversation) => {
    if (
      !post ||
      inFlight.current ||
      useShareSheetStore.getState().sendingTo ||
      !user
    )
      return;
    guardVerified("message", () => {
      if (
        inFlight.current ||
        useShareSheetStore.getState().sendingTo ||
        useAuthStore.getState().user?.id !== viewerId ||
        useWebPostShareStore.getState().post !== post
      )
        return;
      inFlight.current = true;
      setSendingTo(conversation.id);
      void send(conversation.id, post)
        .then(() => {
          if (useAuthStore.getState().user?.id !== viewerId) return;
          showToast(
            "success",
            "Sent",
            `Post shared with ${conversation.user.username}`,
          );
          if (useWebPostShareStore.getState().post === post) close();
        })
        .catch(() => {
          if (useAuthStore.getState().user?.id !== viewerId) return;
          showToast(
            "error",
            "Share failed",
            "Couldn't send this post. Please try again.",
          );
        })
        .finally(() => {
          inFlight.current = false;
          setSendingTo(null);
        });
    });
  };
  const filtered = conversations.filter((c) =>
    c.user.username.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <Drawer open={!!post} onClose={close} side="bottom" title="Share to…">
      <div ref={panel} className="mx-auto max-w-xl">
        {!user ? (
          <p role="status">Sign in to share posts with your conversations.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
              <Search size={18} aria-hidden />
              <input
                aria-label="Search conversations"
                placeholder="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-white outline-none"
              />
            </label>
            {isPending ? (
              <p role="status" className="py-8 text-center text-white/60">
                Loading conversations…
              </p>
            ) : isError ? (
              <div role="alert" className="py-6 text-center">
                <p>Couldn't load conversations.</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-3 text-[#3FDCFF]"
                >
                  Try again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p role="status" className="py-8 text-center text-white/60">
                {query ? "No matching conversations." : "No conversations yet."}
              </p>
            ) : (
              <div
                className="mt-3 max-h-[50dvh] overflow-y-auto overscroll-contain"
                aria-label="Conversations"
              >
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!!sendingTo}
                    onClick={() => handleSend(c)}
                    aria-label={`Share post with @${c.user.username}`}
                    className="flex w-full items-center gap-3 rounded-xl py-3 text-left text-white hover:bg-white/5 disabled:opacity-50"
                  >
                    <UserAvatar
                      uri={c.user.avatar}
                      username={c.user.username}
                      size={44}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      @{c.user.username}
                    </span>
                    {sendingTo === c.id ? (
                      <span role="status">Sending…</span>
                    ) : (
                      <Send size={18} aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>,
    document.body,
  );
}
