"use client";
import { useEffect } from "react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useGuestCheckoutStore } from "@dvnt/app/lib/stores/guest-checkout-store";
import { guestQuoteSelectionKey, isGuestCheckoutQuote } from "@dvnt/app/lib/tickets/guest-checkout-quote";

export function useGuestCheckoutQuote() {
  const s = useGuestCheckoutStore();
  const key = guestQuoteSelectionKey(s);
  const open = s.open;
  const revision = s.quoteRevision;
  const done = s.done;
  useEffect(() => {
    if (!open || done) return;
    const snapshot = useGuestCheckoutStore.getState();
    const abort = new AbortController();
    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const current = () => !cancelled && useGuestCheckoutStore.getState().open &&
      guestQuoteSelectionKey(useGuestCheckoutStore.getState()) === key;
    snapshot.patch({ quote: null, quoteSelectionKey: "", quoteLoading: true, quoteError: null });
    const timer = setTimeout(() => {
      deadline = setTimeout(() => abort.abort(), 15000);
      void (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("guest-checkout", {
            signal: abort.signal,
            body: { action: "quote", quote_request: {
              event_id: Number(snapshot.eventId), ticket_type_id: snapshot.tierId,
              quantity: snapshot.quantity, guest_email: snapshot.email.trim().toLowerCase(),
              discount_code: snapshot.discountCode, promoter_code: snapshot.trackedPromoterCode,
            } },
          });
          let message = "Could not check the ticket total. Please retry.";
          if (error) {
            try {
              const details = await error.context?.json?.();
              message = details?.error?.message || message;
            } catch { /* Keep a safe retry message for network failures. */ }
            throw new Error(message);
          }
          if (!data?.ok || !isGuestCheckoutQuote(data.quote))
            throw new Error(data?.error?.message || "Checkout is updating. Refresh and try again.");
          if (current()) snapshot.patch({ quote: data.quote, quoteSelectionKey: key,
            quoteLoading: false, quoteError: null });
        } catch (error) {
          if (current()) snapshot.patch({ quote: null, quoteLoading: false,
            quoteError: error instanceof Error ? error.message : "Could not check the ticket total." });
        } finally { clearTimeout(deadline); }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(deadline); abort.abort(); };
  }, [open, done, key, revision]);
}
