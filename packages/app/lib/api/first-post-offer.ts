import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import type { ConfirmedEvent } from "@dvnt/app/lib/posts/first-post-draft";

export interface FirstPostServerOffer {
  id: string;
  event: ConfirmedEvent;
}

interface OfferResponse {
  ok?: boolean;
  offer?: FirstPostServerOffer | null;
  reason?: string;
  error?: { message?: string };
}

async function invoke(body: Record<string, unknown>): Promise<OfferResponse> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<OfferResponse>(
    "first-post-offer",
    {
      body,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-auth-token": token,
      },
    },
  );
  if (error) throw new Error(error.message || "Could not load first-post offer");
  if (data?.ok === false) throw new Error(data.error?.message || "Could not load first-post offer");
  return data || {};
}

export const firstPostOfferApi = {
  resolve: async (cartId: string) => invoke({ action: "resolve", cartId }),
  accept: async () => invoke({ action: "accept" }),
  dismiss: async () => invoke({ action: "dismiss" }),
};
