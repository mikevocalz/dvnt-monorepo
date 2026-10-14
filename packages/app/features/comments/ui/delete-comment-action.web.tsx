"use client";

import { useRef } from "react";
import { create } from "zustand";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useDeleteComment } from "@dvnt/app/lib/hooks/use-delete-comment";
import { canDeleteComment } from "@dvnt/app/lib/comments/deletion";

const useDeleteConfirmation = create<{
  target: string | null;
  setTarget: (target: string | null) => void;
}>((set) => ({ target: null, setTarget: (target) => set({ target }) }));

export function DeleteCommentAction({ comment, postId }: {
  comment: { id: string; username: string; parentId?: string | null };
  postId: string;
}) {
  const user = useAuthStore((state) => state.user);
  const signedIn = useAuthStore((state) => state.isAuthenticated);
  const target = useDeleteConfirmation((state) => state.target);
  const setTarget = useDeleteConfirmation((state) => state.setTarget);
  const deletion = useDeleteComment();
  const submitting = useRef(false);
  const key = `${user?.id}:${postId}:${comment.id}`;
  const confirming = target === key;
  if (!canDeleteComment(signedIn, user?.username, comment)) return null;

  const confirm = async () => {
    const current = useAuthStore.getState();
    if (submitting.current || deletion.isPending ||
      current.user?.id !== user?.id ||
      !canDeleteComment(current.isAuthenticated, current.user?.username, comment)) return;
    submitting.current = true;
    try {
      await deletion.mutateAsync({ commentId: comment.id, postId });
      if (useDeleteConfirmation.getState().target === key) setTarget(null);
    } catch {
      // Keep the row and confirmation visible so the user can retry or cancel.
    } finally {
      submitting.current = false;
    }
  };

  return (
    <span data-comment-id={comment.id} className="flex flex-wrap items-center gap-3 text-xs">
      {confirming ? <>
        <span>{comment.parentId ? "Delete this reply?" : "Delete this comment and its replies?"} This cannot be undone.</span>
        <button type="button" disabled={deletion.isPending} onClick={confirm}
          className="font-semibold text-red-400 disabled:opacity-50">
          {deletion.isPending ? "Deleting…" : "Delete for good"}
        </button>
        <button type="button" disabled={deletion.isPending} onClick={() => { setTarget(null); deletion.reset(); }}
          className="font-semibold text-white/70">Keep</button>
        {deletion.isError ? <span role="alert">Couldn’t delete your comment. Please try again.</span> : null}
      </> : <button type="button" onClick={() => { deletion.reset(); setTarget(key); }}
        className="font-semibold text-white/60 hover:text-red-400">Delete</button>}
    </span>
  );
}
