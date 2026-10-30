import type { QueryClient } from "@tanstack/react-query";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { qk } from "@dvnt/app/lib/query/keys";

/** Apply only a confirmed transfer, never speculate about an uncertain request.
 * Cancel older reads before hiding the sender's now-unusable credential. Keep
 * this account-scoped: a response can arrive after the viewer switches accounts.
 */
export async function confirmPendingTransfer(
  queryClient: QueryClient,
  viewerId: string,
  ticketId: string,
  eventId: string,
): Promise<void> {
  const scope = ["tickets", viewerId] as const;
  await queryClient.cancelQueries({ queryKey: scope });
  queryClient.setQueriesData<TicketRecord[]>({ queryKey: scope }, (tickets) =>
    Array.isArray(tickets)
      ? tickets.map((ticket) =>
          ticket.id === ticketId && ticket.status === "active"
            ? { ...ticket, status: "transfer_pending" as const }
            : ticket,
        )
      : tickets,
  );
  void queryClient.invalidateQueries({ queryKey: qk.tickets.mine(viewerId) });
  void queryClient.invalidateQueries({
    queryKey: qk.tickets.forEvent(viewerId, eventId),
  });
  void queryClient.invalidateQueries({
    queryKey: ["ticket-transfers", "outgoing"],
  });
}
