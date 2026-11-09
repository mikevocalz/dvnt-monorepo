import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompCancelStore } from "@dvnt/app/lib/stores/comp-cancel-store";
import { canSubmitCompCancellation } from "@dvnt/app/lib/tickets/organizer-comp-cancel";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
export function useCompCancel(eventId: number) {
  const state = useCompCancelStore();
  const queryClient = useQueryClient();
  useEffect(
    () => () => {
      useCompCancelStore.setState((s) => ({
        ticket: null,
        reason: "",
        error: null,
        busy: false,
        generation: s.generation + 1,
      }));
    },
    [eventId],
  );
  const submit = async () => {
    const s = useCompCancelStore.getState();
    if (
      s.busy ||
      s.error ||
      !canSubmitCompCancellation(s.ticket, eventId, s.reason)
    )
      return;
    const ticket = s.ticket!;
    const generation = s.generation;
    useCompCancelStore.setState({ busy: true, error: null });
    const result = await ticketsApi.cancelOrganizerFreeTicket({
      ticket_id: ticket.id,
      event_id: eventId,
      expected_owner_id: ticket.user_id,
      reason: s.reason.trim(),
    });
    await queryClient
      .invalidateQueries({ queryKey: ["event-attendees", eventId] })
      .catch(() => undefined);
    if (useCompCancelStore.getState().generation !== generation) return;
    useCompCancelStore.setState({ busy: false });
    if (result.ok) {
      useCompCancelStore.getState().close();
      useUIStore
        .getState()
        .showToast(
          "success",
          "Ticket cancelled",
          "Issue the correct event ticket separately after checking the recipient.",
        );
    } else
      useCompCancelStore.setState({
        error: result.error || "Refresh the roster to check the ticket status.",
      });
  };
  return {
    ...state,
    submit,
    valid: canSubmitCompCancellation(state.ticket, eventId, state.reason),
  };
}
