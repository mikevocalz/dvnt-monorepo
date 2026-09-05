"use client";

/**
 * Event Promoters — web (WS-4 promoter economy). Owner/admin surface.
 *
 * Law 1 (data is sacred): identical data flow to the native screen —
 * `promotersApi.list(eventId)` via TanStack Query keyed
 * `["event-promoters", eventId]`; add / update / remove mutations
 * through the same `manage-promoters` edge fn wrappers. Money comes
 * straight off the ledger (integer cents) — display-format only, no
 * client re-math. Distinct from boosts (promote-event-sheet /
 * promotions.ts) everywhere: promoter, never promotion.
 *
 * Law 3: raw semantic HTML + Tailwind (NativeWind interop off). Sticky
 * header "Promoters". Content max-w-2xl, bg #06070d, promoter accent
 * violet #8A40CF. Rounded squares, never circles. List = TanStack
 * Virtual (roster can exceed 50). Local UI state in a tiny Zustand
 * store — never useState. Kit Dialog powers add/edit/remove. Tracked
 * link: https://dvntapp.live/public/events/{id}?ref=CODE (?promo= is
 * taken by promo codes). Rev share is entered as a percent, stored as
 * bps; past orders keep their locked bps.
 */

import { useMemo, useRef } from "react";
import { create } from "zustand";
import { useParams, useRouter } from "solito/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Link2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  UserPlus,
  X,
} from "lucide-react";
import {
  promotersApi,
  promoterShareLink,
  type EventPromoter,
} from "@dvnt/app/lib/api/promoters";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { Dialog } from "@dvnt/ui";

const ACCENT = "#8A40CF"; // promoter violet — cyan is staff, purple tag is promo codes

function bpsLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Percent input string → integer bps (0–10000) or null when invalid. */
function parsePercentToBps(raw: string): number | null {
  const pct = Number(raw.trim());
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round(pct * 100);
}

// --- Local UI state (Zustand, never useState) -----------------------------
interface PromotersUIState {
  addOpen: boolean;
  addMode: "linked" | "external";
  usernameInput: string;
  nameInput: string;
  percentInput: string;
  editTarget: EventPromoter | null;
  editPercentInput: string;
  removeTarget: EventPromoter | null;
  openAdd: () => void;
  closeAdd: () => void;
  setAddMode: (m: "linked" | "external") => void;
  setUsernameInput: (v: string) => void;
  setNameInput: (v: string) => void;
  setPercentInput: (v: string) => void;
  setEditTarget: (p: EventPromoter | null) => void;
  setEditPercentInput: (v: string) => void;
  setRemoveTarget: (p: EventPromoter | null) => void;
  resetAdd: () => void;
}

const usePromotersUIStore = create<PromotersUIState>((set) => ({
  addOpen: false,
  addMode: "linked",
  usernameInput: "",
  nameInput: "",
  percentInput: "10",
  editTarget: null,
  editPercentInput: "",
  removeTarget: null,
  openAdd: () => set({ addOpen: true }),
  closeAdd: () => set({ addOpen: false }),
  setAddMode: (m) => set({ addMode: m }),
  setUsernameInput: (v) => set({ usernameInput: v }),
  setNameInput: (v) => set({ nameInput: v }),
  setPercentInput: (v) => set({ percentInput: v }),
  setEditTarget: (p) =>
    set({
      editTarget: p,
      editPercentInput: p ? String(p.revShareBps / 100) : "",
    }),
  setEditPercentInput: (v) => set({ editPercentInput: v }),
  setRemoveTarget: (p) => set({ removeTarget: p }),
  resetAdd: () =>
    set({
      addOpen: false,
      addMode: "linked",
      usernameInput: "",
      nameInput: "",
      percentInput: "10",
    }),
}));

function PromoterRow({
  promoter,
  canManage,
  onCopyLink,
  onEdit,
  onTogglePause,
  onRemove,
}: {
  promoter: EventPromoter;
  canManage: boolean;
  onCopyLink: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onRemove: () => void;
}) {
  const name = promoter.displayName;
  const handle = promoter.username ? `@${promoter.username}` : "External";
  const paused = promoter.status === "paused";

  return (
    <div
      className="mb-3 rounded-2xl border border-white/8 bg-white/4 p-4"
      style={paused ? { opacity: 0.6 } : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Avatar — rounded square, never a circle. Initial only. */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[17px] font-semibold text-white"
          aria-hidden
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{name}</p>
          <p className="truncate text-sm text-white/45">{handle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold tracking-wide"
            style={{ borderColor: ACCENT, color: "#C084FC" }}
          >
            <Megaphone size={11} color="#C084FC" />
            {promoter.code}
          </span>
          <span className="font-mono text-[11px] text-white/50">
            {bpsLabel(promoter.revShareBps)} share
            {paused ? " · PAUSED" : ""}
          </span>
        </div>
      </div>

      {/* Ledger-backed stats — display formatting only. */}
      <div className="mt-3 flex items-center gap-4 border-t border-white/6 pt-3">
        <p className="flex-1 text-xs text-white/55">
          <span className="font-mono font-semibold text-white">
            {promoter.attributedOrders}
          </span>{" "}
          orders
          <span className="mx-1.5 text-white/25">·</span>
          <span className="font-mono font-semibold text-white">
            {formatCents(promoter.grossCents)}
          </span>{" "}
          gross
          <span className="mx-1.5 text-white/25">·</span>
          <span
            className="font-mono font-semibold"
            style={{ color: promoter.earnedCents >= 0 ? "#22c55e" : "#ef4444" }}
          >
            {formatCents(promoter.earnedCents)}
          </span>{" "}
          earned
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopyLink}
            aria-label={`Copy ${name}'s tracked link`}
            title="Copy tracked link"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 active:bg-white/10"
          >
            <Link2 size={14} color="#3FDCFF" />
          </button>
          {canManage ? (
            <>
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${name}'s share`}
                title="Edit rev share"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 active:bg-white/10"
              >
                <Pencil size={14} color="rgba(255,255,255,0.7)" />
              </button>
              <button
                type="button"
                onClick={onTogglePause}
                aria-label={paused ? `Resume ${name}` : `Pause ${name}`}
                title={paused ? "Resume" : "Pause"}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 active:bg-white/10"
              >
                {paused ? (
                  <Play size={14} color="#22c55e" />
                ) : (
                  <Pause size={14} color="#f59e0b" />
                )}
              </button>
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${name}`}
                title="Remove"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 active:bg-white/10"
              >
                <X size={14} color="rgba(255,255,255,0.5)" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EventPromotersScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);

  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const addOpen = usePromotersUIStore((s) => s.addOpen);
  const addMode = usePromotersUIStore((s) => s.addMode);
  const usernameInput = usePromotersUIStore((s) => s.usernameInput);
  const nameInput = usePromotersUIStore((s) => s.nameInput);
  const percentInput = usePromotersUIStore((s) => s.percentInput);
  const editTarget = usePromotersUIStore((s) => s.editTarget);
  const editPercentInput = usePromotersUIStore((s) => s.editPercentInput);
  const removeTarget = usePromotersUIStore((s) => s.removeTarget);
  const openAdd = usePromotersUIStore((s) => s.openAdd);
  const closeAdd = usePromotersUIStore((s) => s.closeAdd);
  const setAddMode = usePromotersUIStore((s) => s.setAddMode);
  const setUsernameInput = usePromotersUIStore((s) => s.setUsernameInput);
  const setNameInput = usePromotersUIStore((s) => s.setNameInput);
  const setPercentInput = usePromotersUIStore((s) => s.setPercentInput);
  const setEditTarget = usePromotersUIStore((s) => s.setEditTarget);
  const setEditPercentInput = usePromotersUIStore((s) => s.setEditPercentInput);
  const setRemoveTarget = usePromotersUIStore((s) => s.setRemoveTarget);
  const resetAdd = usePromotersUIStore((s) => s.resetAdd);

  const promotersQuery = useQuery({
    queryKey: ["event-promoters", eventId],
    queryFn: () => promotersApi.list(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 15_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["event-promoters", eventId] });

  const addMutation = useMutation({
    mutationFn: (input: {
      username?: string;
      displayName?: string;
      revShareBps: number;
    }) => promotersApi.add({ eventId, ...input }),
    onSuccess: (promoter) => {
      showToast(
        "success",
        "Promoter added",
        `Code ${promoter.code} — copy their link to share.`,
      );
      resetAdd();
      invalidate();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      showToast("error", "Couldn't add promoter", err?.message || "Try again.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      promoterId: string;
      revShareBps?: number;
      status?: "active" | "paused";
    }) => promotersApi.update(input),
    onSuccess: () => {
      setEditTarget(null);
      invalidate();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      showToast("error", "Update failed", err?.message || "Try again.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (promoterId: string) => promotersApi.remove(promoterId),
    onSuccess: () => {
      showToast("success", "Promoter removed", "Their ledger history is kept.");
      setRemoveTarget(null);
      invalidate();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      showToast("error", "Couldn't remove", err?.message || "Try again.");
    },
  });

  const promoters = promotersQuery.data?.promoters || [];
  const callerRole = promotersQuery.data?.callerRole || null;
  const canManage = callerRole === "owner" || callerRole === "admin";

  const items = useMemo(() => promoters, [promoters]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });

  const copyLink = (promoter: EventPromoter) => {
    const link = promoterShareLink(eventId, promoter.code);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(link)
        .then(() =>
          showToast("success", "Link copied", `${promoter.code} tracked link.`),
        )
        .catch(() => showToast("error", "Copy failed", link));
    } else {
      showToast("error", "Copy unsupported", link);
    }
  };

  const onAddSubmit = () => {
    const bps = parsePercentToBps(percentInput);
    if (bps == null) {
      showToast("error", "Invalid share", "Enter a percent from 0 to 100.");
      return;
    }
    if (addMode === "linked") {
      const u = usernameInput.trim().replace(/^@/, "");
      if (!u) {
        showToast("error", "Username required", "");
        return;
      }
      addMutation.mutate({ username: u, revShareBps: bps });
    } else {
      const n = nameInput.trim();
      if (!n) {
        showToast("error", "Name required", "");
        return;
      }
      addMutation.mutate({ displayName: n, revShareBps: bps });
    }
  };

  const onEditSubmit = () => {
    if (!editTarget) return;
    const bps = parsePercentToBps(editPercentInput);
    if (bps == null) {
      showToast("error", "Invalid share", "Enter a percent from 0 to 100.");
      return;
    }
    updateMutation.mutate({ promoterId: editTarget.id, revShareBps: bps });
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header — mirrors staff.web. */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">Promoters</h1>
        {canManage ? (
          <button
            onClick={openAdd}
            aria-label="Add promoter"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <UserPlus size={20} color="#fff" />
          </button>
        ) : (
          <span className="w-9" />
        )}
      </div>

      {promotersQuery.isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#8A40CF]" />
          <p className="mt-4 text-sm text-white/60">Loading promoters…</p>
        </div>
      ) : promotersQuery.isError ? (
        <main className="mx-auto w-full max-w-2xl px-8 py-24">
          <p className="text-center text-sm text-white/40">
            Couldn&apos;t load promoters. Refresh to retry.
          </p>
        </main>
      ) : items.length === 0 ? (
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-8 py-24 text-center">
          <Megaphone size={36} color="rgba(138,64,207,0.6)" />
          <p className="text-[17px] font-semibold text-white">
            No promoters yet
          </p>
          <p className="max-w-sm text-sm leading-5 text-white/45">
            Give promoters a tracked link and a rev share. Orders they drive
            are attributed automatically and earnings land in their ledger.
          </p>
          {canManage ? (
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 rounded-xl px-5 py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Add your first promoter
            </button>
          ) : null}
        </main>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 py-6">
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 140px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const promoter = items[vItem.index];
                if (!promoter) return null;
                return (
                  <div
                    key={promoter.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    <PromoterRow
                      promoter={promoter}
                      canManage={canManage}
                      onCopyLink={() => copyLink(promoter)}
                      onEdit={() => setEditTarget(promoter)}
                      onTogglePause={() =>
                        updateMutation.mutate({
                          promoterId: promoter.id,
                          status:
                            promoter.status === "paused" ? "active" : "paused",
                        })
                      }
                      onRemove={() => setRemoveTarget(promoter)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* Add — kit Dialog: linked (@username) or external (name-only). */}
      <Dialog
        open={addOpen && canManage}
        onClose={() => {
          if (!addMutation.isPending) closeAdd();
        }}
        title="Add promoter"
        footer={
          <>
            <button
              disabled={addMutation.isPending}
              onClick={closeAdd}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={addMutation.isPending}
              onClick={onAddSubmit}
              className="flex-1 rounded-xl py-3 font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {addMutation.isPending ? "Adding…" : "Add promoter"}
            </button>
          </>
        }
      >
        <div className="flex gap-2">
          {(
            [
              { value: "linked", label: "DVNT user" },
              { value: "external", label: "External" },
            ] as const
          ).map((opt) => {
            const selected = addMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAddMode(opt.value)}
                className="flex-1 rounded-xl border py-2.5 text-sm font-semibold"
                style={
                  selected
                    ? {
                        borderColor: ACCENT,
                        backgroundColor: `${ACCENT}22`,
                        color: "#C084FC",
                      }
                    : {
                        borderColor: "rgba(255,255,255,0.08)",
                        color: "#fff",
                      }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {addMode === "linked" ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
            <span className="text-[17px] font-semibold text-white/50">@</span>
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={addMutation.isPending}
              className="flex-1 bg-transparent text-[17px] text-white placeholder:text-white/35 outline-none disabled:opacity-50"
            />
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-white/6 px-3 py-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Promoter name (no DVNT account)"
              disabled={addMutation.isPending}
              className="w-full bg-transparent text-[17px] text-white placeholder:text-white/35 outline-none disabled:opacity-50"
            />
          </div>
        )}

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
            Rev share — % of the organizer payout per attributed order
          </span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
            <input
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              inputMode="decimal"
              placeholder="10"
              disabled={addMutation.isPending}
              className="flex-1 bg-transparent font-mono text-[17px] text-white placeholder:text-white/35 outline-none disabled:opacity-50"
            />
            <span className="font-mono text-[15px] text-white/50">%</span>
          </div>
        </label>
        <p className="mt-2 text-[11px] leading-4 text-white/35">
          The share locks per order at purchase time — changing it later never
          re-prices past orders.
        </p>
      </Dialog>

      {/* Edit rev share — kit Dialog. */}
      <Dialog
        open={!!editTarget}
        onClose={() => {
          if (!updateMutation.isPending) setEditTarget(null);
        }}
        title={`Edit ${editTarget?.displayName ?? "promoter"}`}
        footer={
          <>
            <button
              disabled={updateMutation.isPending}
              onClick={() => setEditTarget(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={updateMutation.isPending}
              onClick={onEditSubmit}
              className="flex-1 rounded-xl py-3 font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
            Rev share %
          </span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
            <input
              value={editPercentInput}
              onChange={(e) => setEditPercentInput(e.target.value)}
              inputMode="decimal"
              disabled={updateMutation.isPending}
              className="flex-1 bg-transparent font-mono text-[17px] text-white outline-none disabled:opacity-50"
            />
            <span className="font-mono text-[15px] text-white/50">%</span>
          </div>
        </label>
        <p className="mt-2 text-[11px] leading-4 text-white/35">
          Applies to future orders only — past orders keep their locked share.
        </p>
      </Dialog>

      {/* Remove confirmation — kit Dialog. */}
      <Dialog
        open={!!removeTarget}
        onClose={() => {
          if (!removeMutation.isPending) setRemoveTarget(null);
        }}
        title="Remove promoter"
        footer={
          <>
            <button
              disabled={removeMutation.isPending}
              onClick={() => setRemoveTarget(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={removeMutation.isPending}
              onClick={() => {
                if (removeTarget) removeMutation.mutate(removeTarget.id);
              }}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {removeMutation.isPending ? "Removing…" : "Remove"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Remove{" "}
          <span className="font-semibold text-white">
            {removeTarget?.displayName || "this promoter"}
          </span>
          ? Their link stops attributing immediately. Past attributions and
          ledger earnings are kept.
        </p>
      </Dialog>
    </div>
  );
}

export default EventPromotersScreen;
