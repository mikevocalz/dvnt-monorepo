"use client";

/**
 * CompTicketsModal — WEB fork of the native comp sheet. Same props, same
 * server contract (`bulk-comp-tickets` via `bulkCompTickets`), same shared
 * logic (`lib/tickets/comp-recipients`); only the presentation differs.
 *
 * Law 3: raw semantic HTML + Tailwind, NativeWind interop off. The shell is
 * the project's web `BottomSheet` (portal, scrim, Escape, scroll lock) rather
 * than a second dialog implementation.
 *
 * Form state (tier, recipients, note) lives in the attendees Zustand store,
 * never useState. Tiers and the comp result are SERVER state and live in
 * TanStack Query — `mutation.data` is the result, `mutation.isPending` is the
 * in-flight flag.
 *
 * Issued is not delivered. The result panel keeps them in two columns so a
 * host cannot read "5 issued" as "5 people got an email".
 */

import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gift, Check, AlertCircle, Mail } from "lucide-react";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { bulkCompTickets, type CompResult } from "@dvnt/app/lib/api/privileged";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAttendeesStore } from "@dvnt/app/lib/stores/attendees-store";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import {
  MAX_COMP_RECIPIENTS,
  canSubmitComp,
  parseCompRecipients,
  summarizeCompResult,
} from "@dvnt/app/lib/tickets/comp-recipients";

const MAX_NOTE = 240;
const ACCENT = "#3FDCFF";

interface Tier {
  id: string;
  name: string;
  tier?: string;
  price_cents?: number;
  quantity_total?: number | null;
  quantity_sold?: number | null;
  is_active?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  eventTitle?: string;
  onSuccess?: (result: CompResult) => void;
}

/**
 * Two numbers, side by side, because they are two different facts. A ticket
 * that exists and an email that arrived are reported separately everywhere
 * else in this flow; flattening them into one "sent" count here would undo
 * that.
 */
function ResultPanel({ result }: { result: CompResult }) {
  const s = summarizeCompResult(result);
  const failed = (result.delivery ?? []).filter((d) => d.status !== "delivered");
  return (
    <div>
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10">
        <div className="px-4 py-4">
          <p className="text-[32px] font-bold leading-none tabular-nums text-white">
            {s.totalIssued}
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            Tickets issued
          </p>
          <p className="mt-1 text-[13px] text-white/50">
            {s.issued} to accounts
            {s.guestIssued ? ` · ${s.guestIssued} to guests` : ""}
            {result.tier ? ` · ${result.tier}` : ""}
          </p>
        </div>
        <div className="border-l border-white/10 px-4 py-4">
          <p
            className="text-[32px] font-bold leading-none tabular-nums"
            style={{ color: s.undelivered > 0 ? "#F59E0B" : ACCENT }}
          >
            {s.delivered}
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            Claim emails sent
          </p>
          <p className="mt-1 text-[13px] text-white/50">
            {s.undelivered > 0
              ? `${s.undelivered} didn't go out`
              : s.guestIssued === 0
                ? "No guest emails in this batch"
                : "Every guest email went out"}
          </p>
        </div>
      </div>

      {failed.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/8 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-300">
            <Mail size={14} /> These tickets exist but the email didn&apos;t
            arrive
          </p>
          <ul className="mt-2 space-y-1">
            {failed.map((d) => (
              <li key={d.recipient} className="text-[13px] text-white/60">
                {d.recipient} — {d.error || "not delivered"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-white/45">
            The tickets stay valid. Check the address and comp it again, or
            pass the claim link on yourself.
          </p>
        </div>
      ) : null}

      {result.skipped.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-white/70">
            <AlertCircle size={14} /> {result.skipped.length} skipped
          </p>
          <ul className="mt-2 space-y-1">
            {result.skipped.slice(0, 8).map((sk, i) => (
              <li key={`${sk.recipient}-${i}`} className="text-[13px] text-white/50">
                {sk.recipient} — {sk.reason}
              </li>
            ))}
          </ul>
          {result.skipped.length > 8 ? (
            <p className="mt-1 text-[13px] text-white/40">
              and {result.skipped.length - 8} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CompTicketsModal({
  visible,
  onClose,
  eventId,
  eventTitle,
  onSuccess,
}: Props) {
  const showToast = useUIStore((s) => s.showToast);
  const tierId = useAttendeesStore((s) => s.compTierId);
  const setTierId = useAttendeesStore((s) => s.setCompTierId);
  const recipientsRaw = useAttendeesStore((s) => s.compRecipients);
  const setRecipientsRaw = useAttendeesStore((s) => s.setCompRecipients);
  const note = useAttendeesStore((s) => s.compNote);
  const setNote = useAttendeesStore((s) => s.setCompNote);

  const tiersQuery = useQuery({
    queryKey: ["event-ticket-types", eventId],
    queryFn: () => ticketsApi.getTicketTypes(String(eventId)),
    enabled: visible && eventId > 0,
  });
  const tiers = useMemo(
    () =>
      ((tiersQuery.data ?? []) as Tier[]).filter((t) => t.is_active !== false),
    [tiersQuery.data],
  );

  // Default to the first active tier once they land. The store is cleared on
  // open, so this only ever fills an empty selection, never overrides a choice.
  useEffect(() => {
    if (visible && !tierId && tiers.length > 0) setTierId(tiers[0]!.id);
  }, [visible, tierId, tiers, setTierId]);

  const preview = useMemo(
    () => parseCompRecipients(recipientsRaw),
    [recipientsRaw],
  );

  const mutation = useMutation({
    mutationFn: () =>
      bulkCompTickets(eventId, tierId!, preview.entries, note.trim() || undefined),
    onSuccess: (res) => {
      onSuccess?.(res);
      const s = summarizeCompResult(res);
      if (s.totalIssued > 0) {
        showToast(
          s.undelivered > 0 ? "warning" : "success",
          "Tickets comped",
          [
            `${s.totalIssued} issued`,
            s.guestIssued ? `${s.guestIssued} by email` : "",
            s.undelivered
              ? `${s.undelivered} email${s.undelivered === 1 ? "" : "s"} failed`
              : "",
            s.skipped ? `${s.skipped} skipped` : "",
          ]
            .filter(Boolean)
            .join(", ") + ".",
        );
      } else if (s.skipped > 0) {
        showToast(
          "warning",
          "Nothing issued",
          `${s.skipped} recipient${s.skipped === 1 ? "" : "s"} skipped.`,
        );
      }
    },
    onError: (err: Error) => {
      showToast("error", "Comp failed", err?.message || "Couldn't comp tickets.");
    },
  });

  const result = mutation.data ?? null;
  const sending = mutation.isPending;
  const ready = canSubmitComp({ tierId, preview, sending });

  // A send in flight owns the sheet — closing mid-request would leave the host
  // with no idea which tickets were issued.
  const handleClose = () => {
    if (sending) return;
    mutation.reset();
    onClose();
  };

  const footer = result ? (
    <button
      type="button"
      onClick={handleClose}
      className="rounded-xl bg-white px-5 py-2.5 text-[15px] font-semibold text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
    >
      Done
    </button>
  ) : (
    <>
      <p className="mr-auto text-[13px] tabular-nums text-white/45">
        {preview.entries.length === 0
          ? "No recipients yet"
          : `${preview.entries.length} recipient${
              preview.entries.length === 1 ? "" : "s"
            } · ${preview.members} member${
              preview.members === 1 ? "" : "s"
            } · ${preview.emails} email${preview.emails === 1 ? "" : "s"}`}
      </p>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={!ready}
        className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[15px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        {sending ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
        ) : (
          <Gift size={16} />
        )}
        {sending
          ? "Comping…"
          : `Comp ${preview.entries.length || ""} ticket${
              preview.entries.length === 1 ? "" : "s"
            }`}
      </button>
    </>
  );

  return (
    <BottomSheet
      open={visible}
      onClose={handleClose}
      title="Comp tickets"
      footer={footer}
    >
      {result ? (
        <ResultPanel result={result} />
      ) : (
        <div className="space-y-5">
          {/* The toast is gone in four seconds and the host is still looking
              at a full form. This stays until they act on it.
              "Failed" is not "issued nothing": a dropped response can follow a
              server that already minted the tickets, so this never claims the
              batch didn't land — it sends the host to the roster to look,
              which is the one place that actually knows. */}
          {mutation.isError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-400/30 bg-red-400/8 p-4"
            >
              <p className="flex items-center gap-2 text-[13px] font-semibold text-red-300">
                <AlertCircle size={14} /> The comp didn&apos;t come back
              </p>
              <p className="mt-1 text-[13px] text-white/60">
                {mutation.error?.message || "The request didn't go through."}{" "}
                Close this and check the roster before sending again — some
                tickets may already have been issued.
              </p>
            </div>
          ) : null}

          {eventTitle ? (
            <p className="text-[13px] text-white/45">
              Free tickets for{" "}
              <span className="font-semibold text-white/80">{eventTitle}</span>
            </p>
          ) : null}

          <fieldset className="min-w-0">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
              Tier
            </legend>
            {tiersQuery.isLoading ? (
              <p className="text-[13px] text-white/40">Loading tiers…</p>
            ) : tiers.length === 0 ? (
              // ponytail: `ticketsApi.getTicketTypes` swallows its error and
              // returns [], so "no tiers" and "the request failed" arrive
              // identical here. Rather than assert a cause we can't know, say
              // what came back and offer the retry that covers both. Fixing it
              // properly means changing that shared API — out of this surface.
              <div>
                <p className="text-[13px] text-white/45">
                  No active ticket tiers came back for this event.
                </p>
                <button
                  type="button"
                  onClick={() => tiersQuery.refetch()}
                  className="mt-2 rounded-lg bg-white/8 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tiers.map((t) => {
                  const selected = tierId === t.id;
                  const remaining =
                    t.quantity_total != null
                      ? Math.max(
                          0,
                          Number(t.quantity_total) - Number(t.quantity_sold || 0),
                        )
                      : null;
                  const accent = tierAccent((t.tier as never) || "ga");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTierId(t.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-white/70 bg-white/10"
                          : "border-white/12 hover:bg-white/5"
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60`}
                    >
                      {selected ? <Check size={14} color={accent} /> : null}
                      <span className="text-[14px] font-semibold text-white">
                        {t.name}
                      </span>
                      <span className="text-[12px] tabular-nums text-white/45">
                        {remaining != null ? `${remaining} left` : "Unlimited"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div>
            <label
              htmlFor="comp-recipients"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
            >
              Recipients
            </label>
            <textarea
              id="comp-recipients"
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
              disabled={sending}
              rows={4}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="@username, friend@example.com, …"
              className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[15px] text-white placeholder:text-white/30 outline-none focus:border-white/30 focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
            />
            {preview.overLimit ? (
              <p className="mt-2 text-[13px] text-amber-300">
                {preview.entries.length} recipients — {MAX_COMP_RECIPIENTS} is
                the most one batch can carry. Split the list.
              </p>
            ) : null}
            <p className="mt-2 text-[13px] leading-relaxed text-white/45">
              A DVNT username lands in that member&apos;s wallet. An email with
              no account gets a guest ticket emailed as a claim link — no
              sign-up needed to get in. Phone numbers aren&apos;t supported.
              Separate entries with a comma, semicolon, or new line.
            </p>
          </div>

          <div>
            <label
              htmlFor="comp-note"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
            >
              Note (optional)
            </label>
            <input
              id="comp-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
              disabled={sending}
              placeholder="e.g. Friends of the venue — see you at the door."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[15px] text-white placeholder:text-white/30 outline-none focus:border-white/30 focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
