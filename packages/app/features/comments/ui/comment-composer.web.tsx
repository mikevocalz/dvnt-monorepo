"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Send } from "lucide-react";
import { useCreateComment } from "@dvnt/app/lib/hooks/use-comments";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";

/** In-flow on every web surface: never obscure the comment being replied to. */
export function WebCommentComposer({ postId, parentCommentId, hideWhenClosed = false }: {
  postId: string;
  parentCommentId?: string;
  hideWhenClosed?: boolean;
}) {
  const { open, text, replyTo, setText, setReplyTo, openComposer, reset, bindContext } = useCommentDraftStore();
  const user = useAuthStore((s) => s.user);
  const mutation = useCreateComment();
  const guardVerified = useVerifiedGate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const composerRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const label = parentCommentId ? "Add a reply" : "Add a comment";

  const context = `${postId}:${parentCommentId || "comments"}`;
  useLayoutEffect(() => { bindContext(context); }, [context, bindContext]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [context]);

  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (!wasOpen.current && document.activeElement instanceof HTMLElement && document.activeElement !== inputRef.current) {
      returnFocus.current = document.activeElement;
    }
    wasOpen.current = true;
    inputRef.current?.focus({ preventScroll: true });
    composerRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, replyTo?.commentId]);

  const close = () => {
    if (sending.current) return;
    reset();
    mutation.reset();
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
      else triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const submit = () => {
    if (!postId || !text.trim() || sending.current || mutation.isPending) return;
    const revision = useCommentDraftStore.getState().revision;
    guardVerified("comment", () => {
      const current = useCommentDraftStore.getState();
      if (!mounted.current || !current.open || current.context !== context || current.revision !== revision || sending.current) return;
      sending.current = true;
      mutation.mutate({
        post: postId, text: text.trim(),
        parent: parentCommentId || replyTo?.commentId,
        replyToCommentId: replyTo?.commentId || parentCommentId,
        authorUsername: user?.username, authorId: user?.id,
      }, {
        onSuccess: () => {
          const current = useCommentDraftStore.getState();
          // A newer reply target must not be cleared by an older request.
          if (mounted.current && current.context === context && current.revision === revision) reset();
        },
        onSettled: () => { sending.current = false; },
      });
    });
  };

  if (!open && hideWhenClosed) return null;
  return (
    <section
      ref={composerRef}
      aria-label="Comment composer"
      className="relative mx-auto w-full max-w-2xl shrink-0 px-3 pt-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px + var(--dvnt-tabbar-clearance, 0px))" }}
    >
      {!open ? (
        <button ref={triggerRef} type="button" onClick={() => openComposer()} className="w-full rounded-2xl border border-white/12 bg-[#0b0d16] px-4 py-3 text-left text-base text-white/55">
          {label}…
        </button>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="overflow-hidden rounded-2xl border border-white/12 bg-[#0b0d16]" aria-busy={mutation.isPending}>
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 bg-[#171923] px-3 py-2 text-sm text-white/65">
            <span className="min-w-0 break-words">{replyTo ? `Replying to @${replyTo.username}` : label}</span>
            <div className="flex shrink-0 items-center gap-3">
              {replyTo && <button type="button" disabled={mutation.isPending} onClick={() => setReplyTo(null)} className="min-h-9 disabled:opacity-40">Cancel reply</button>}
              <button type="button" disabled={mutation.isPending} onClick={close} aria-label="Close composer" className="min-h-9 font-medium disabled:opacity-40">Close</button>
            </div>
          </div>
          <div className="flex items-end gap-2 px-3 py-3">
            <textarea
              ref={inputRef} rows={2} value={text} disabled={mutation.isPending}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Escape") { event.preventDefault(); close(); }
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
              }}
              placeholder={replyTo ? `Reply to @${replyTo.username}…` : `${label}…`}
              aria-label={replyTo ? `Reply to ${replyTo.username}` : label}
              className="min-w-0 flex-1 resize-y bg-transparent text-base text-white outline-none placeholder:text-white/40 disabled:opacity-60"
              style={{ minHeight: 48, maxHeight: 160 }}
            />
            <button type="submit" disabled={!text.trim() || mutation.isPending} aria-label={parentCommentId || replyTo ? "Post reply" : "Post comment"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#3FDCFF] focus-visible:outline focus-visible:outline-2 disabled:opacity-35">
              <Send size={20} />
            </button>
          </div>
          {mutation.isPending && <p role="status" className="px-3 pb-3 text-sm text-white/60">Posting…</p>}
          {mutation.isError && <p role="alert" className="px-3 pb-3 text-sm text-rose-300">Could not post. Your draft is saved here. Try again.</p>}
        </form>
      )}
    </section>
  );
}
