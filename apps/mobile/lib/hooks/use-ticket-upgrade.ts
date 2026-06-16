/**
 * Ticket Upgrade Hooks
 *
 * useTicketUpgradeOptions — returns higher-priced tiers available for upgrade
 * useInitiateUpgrade      — calls ticket-upgrade Edge Function → opens Stripe URL
 */

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Linking } from "react-native";
import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";
import { ticketKeys } from "./use-tickets";
import type { TicketRecord } from "@/lib/api/tickets";
import type { TicketTypeRecord } from "@/lib/api/ticket-types";

export interface UpgradeTierOption {
  tier: TicketTypeRecord;
  diffCents: number;
  available: boolean;
}

/**
 * Derives which tiers can be upgraded to from the user's current ticket.
 * Returns tiers that cost MORE than what was paid, are active, and have inventory.
 */
export function useTicketUpgradeOptions(
  allTiers: TicketTypeRecord[],
  myTicket: TicketRecord | null | undefined,
): UpgradeTierOption[] {
  return useMemo(() => {
    if (!myTicket || myTicket.status !== "active" || myTicket.checked_in_at) {
      return [];
    }
    const paidCents = myTicket.purchase_amount_cents || 0;

    return allTiers
      .filter(
        (t) =>
          t.is_active &&
          t.price_cents > paidCents &&
          String(t.id) !== String(myTicket.ticket_type_id),
      )
      .map((t) => ({
        tier: t,
        diffCents: t.price_cents - paidCents,
        available: (t.quantity_total - t.quantity_sold) > 0,
      }))
      .sort((a, b) => a.tier.price_cents - b.tier.price_cents);
  }, [allTiers, myTicket]);
}

interface InitiateUpgradeParams {
  ticketId: string;
  newTicketTypeId: string;
}

interface InitiateUpgradeResult {
  url: string;
  diff_cents: number;
}

/**
 * Calls the ticket-upgrade Edge Function and opens the Stripe Checkout URL.
 */
export function useInitiateUpgrade(eventId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, newTicketTypeId }: InitiateUpgradeParams): Promise<InitiateUpgradeResult> => {
      const token = await requireBetterAuthToken();

      const { data, error } = await supabase.functions.invoke<InitiateUpgradeResult>(
        "ticket-upgrade",
        {
          body: { ticket_id: ticketId, new_ticket_type_id: newTicketTypeId },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );

      if (error) throw new Error(error.message || "Upgrade request failed");
      if (!data?.url) throw new Error("No checkout URL returned");
      return data;
    },
    onSuccess: async (data) => {
      // Open Stripe Checkout in the system browser
      await Linking.openURL(data.url);
    },
    onSettled: () => {
      // Refresh ticket data after upgrade attempt (webhook may have completed)
      queryClient.invalidateQueries({ queryKey: ticketKeys.myTickets() });
      queryClient.invalidateQueries({ queryKey: ticketKeys.myTicketForEvent(eventId) });
      queryClient.invalidateQueries({ queryKey: ticketKeys.ticketTypes(eventId) });
    },
  });
}
