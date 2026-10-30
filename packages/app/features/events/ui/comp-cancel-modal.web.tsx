"use client";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";
import {
  COMP_CANCEL_WARNING,
  compCancelHolder,
} from "@dvnt/app/lib/tickets/organizer-comp-cancel";
import { useCompCancel } from "./use-comp-cancel";
export function CompCancelModal({ eventId }: { eventId: number }) {
  const s = useCompCancel(eventId);
  const ticket = s.ticket;
  return (
    <BottomSheet
      open={!!ticket && ticket.event_id === eventId}
      onClose={s.close}
      title="Cancel incorrectly issued free ticket"
      maxWidthClass="max-w-lg"
    >
      {ticket ? (
        <div className="space-y-4 p-5 text-white">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="font-semibold">
              {ticket.event_title || `Event ${eventId}`}
            </p>
            <p>
              {ticket.event_location || "Confirm this event before cancelling"}
            </p>
            <p className="mt-3">
              {compCancelHolder(ticket)} ·{" "}
              {ticket.ticket_type_name || "General"}
            </p>
            <p className="break-all text-xs text-white/50">
              Ticket {ticket.id}
            </p>
          </div>
          <p className="text-sm text-white/70">{COMP_CANCEL_WARNING}</p>
          {!ticket.organizer_free_cancel?.eligible ? (
            <p role="alert" className="text-amber-300">
              {ticket.organizer_free_cancel?.reason ||
                "This ticket cannot be cancelled here."}
            </p>
          ) : null}
          <label className="block text-sm">
            Reason for cancellation
            <textarea
              disabled={s.busy}
              value={s.reason}
              onChange={(e) => s.setReason(e.target.value)}
              minLength={5}
              maxLength={240}
              placeholder="For example: issued DC instead of New York"
              className="mt-2 block w-full rounded-lg border border-white/15 bg-white/5 p-3"
            />
          </label>
          {s.error ? (
            <p role="alert" className="text-red-300">
              {s.error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={s.busy}
              onClick={s.close}
              className="flex-1 rounded-lg border border-white/20 px-4 py-3 disabled:opacity-40"
            >
              Keep ticket
            </button>
            <button
              type="button"
              disabled={!s.valid || s.busy || !!s.error}
              onClick={s.submit}
              className="flex-1 rounded-lg bg-red-600 px-4 py-3 font-semibold disabled:opacity-40"
            >
              {s.busy ? "Cancelling…" : "Cancel this free ticket"}
            </button>
          </div>
          {s.error ? (
            <p className="text-xs text-white/60">
              Close this review and refresh the roster before another attempt.
            </p>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}
