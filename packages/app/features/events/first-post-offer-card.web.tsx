"use client";

import type { MixedTicket } from "@dvnt/app/lib/contracts/dto";
import { useRouter } from "solito/navigation";
import { useFirstPostOffer } from "@dvnt/app/lib/hooks/use-first-post-offer";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

export function FirstPostOfferCard({
  cartId,
  tickets,
}: {
  cartId: string;
  tickets: readonly MixedTicket[];
}) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const firstPost = useFirstPostOffer(cartId, tickets);

  if (!firstPost.draft) return null;

  const handleMakeFirstPost = async () => {
    if (!firstPost.draft) return;
    try {
      const result = await firstPost.accept(firstPost.draft);
      if (result === "kept-existing") {
        showToast("info", "Post in progress", "We kept the post you started.");
        return;
      }
      if (result === "unavailable") {
        showToast("info", "Offer already used", "Your first-post offer has already been resolved.");
        return;
      }
      router.push("/feed/create");
    } catch (error) {
      showToast(
        "error",
        "Couldn't start your post",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  };

  return (
    <section className="mt-4 flex flex-col gap-2.5 rounded-xl border border-purple-400/25 bg-purple-500/8 p-4">
      <h2 className="text-base font-extrabold text-white">
        Make this your first post
      </h2>
      <p className="text-[13px] leading-[18px] text-white/65">
        We can start a text post about this event for you to edit. It goes
        to your DVNT feed, where anyone can see it, and only when you tap Post.
      </p>
      <p className="whitespace-pre-line rounded-lg bg-black/35 p-3 text-[13px] leading-[19px] text-white/85">
        {firstPost.draft.content}
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => void firstPost.skip()}
          className="flex h-11 flex-1 items-center justify-center rounded-xl bg-white/8 text-sm font-bold text-white active:bg-white/12"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => void handleMakeFirstPost()}
          className="flex h-11 flex-1 items-center justify-center rounded-xl bg-purple-500 text-sm font-extrabold text-white active:bg-purple-400"
        >
          Edit my first post
        </button>
      </div>
    </section>
  );
}

export default FirstPostOfferCard;
