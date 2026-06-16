"use client";

/**
 * Event Promo Codes Screen — WEB port of the native organizer screen
 * (`app/(protected)/events/[id]/promo-codes.tsx`).
 *
 * Law 1 (data flow is sacred): consumes the EXACT same server contract as
 * native — the screen reads/writes the `promo_codes` table directly through the
 * shared `supabase` client (native has no dedicated hook; the queries ARE the
 * contract). The list is `from("promo_codes").select("*").eq("event_id", id)
 * .order("created_at", { ascending: false })`; create is the same `.insert({...})`
 * payload (code upper-cased, dollars→cents, `created_by` from
 * `getCurrentUserAuthId()`, duplicate `23505` → "already exists"); delete is the
 * same `.delete().eq("id", promoId)`. Toasts go through `useUIStore.showToast`
 * exactly like native. The read/create/delete are wrapped in TanStack Query
 * (`useQuery` + two `useMutation`s) so the web cache invalidates the list — the
 * underlying supabase calls are byte-for-byte the native ones.
 *
 * Law 2 (web lists = TanStack Virtual): the codes list renders through
 * `@tanstack/react-virtual` over a scroll container — never FlatList / FlashList.
 *
 * Law 3 (presentation): raw semantic HTML + Tailwind only (NativeWind interop is
 * off — className only on DOM tags, no <View>/<Text>). Sticky glass header
 * ("Promo Codes") like legal-page.web.tsx, content column `max-w-2xl`, bg
 * #06070d, cyan #3FDCFF accent. Create form uses kit `FormField` inside a kit
 * `Dialog` sheet; the delete confirm is a kit `Dialog`. Screen-local UI state
 * (create sheet + form draft + pending-delete) lives in Zustand, never useState.
 * Status surfaces as a badge (Exhausted) — never a pill. Navigation via Solito;
 * id via useParams.
 */

import { useMemo, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import { X, Plus, Tag, Trash2, Copy, Percent, DollarSign } from "lucide-react";
import { FormField, Dialog } from "@dvnt/ui";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usePromoCodesUIStore } from "@dvnt/app/lib/stores/promo-codes-ui-store";

interface PromoCode {
  id: string;
  code: string;
  discount_type: "percent" | "fixed_cents";
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  valid_from: string | null;
  valid_until: string | null;
  ticket_type_id: string | null;
  created_at: string;
}

// Pending-delete confirm flag — kept in its own tiny Zustand store (never
// useState), mirroring the native Alert.alert confirm with a kit Dialog.
interface DeleteState {
  pending: PromoCode | null;
  isDeleting: boolean;
  setPending: (value: PromoCode | null) => void;
  setIsDeleting: (value: boolean) => void;
}
const useDeleteStore = create<DeleteState>((set) => ({
  pending: null,
  isDeleting: false,
  setPending: (pending) => set({ pending }),
  setIsDeleting: (isDeleting) => set({ isDeleting }),
}));

const ACCENT = "#3FDCFF";
const ROW_HEIGHT = 96; // card + 10px gap

function formatDiscount(type: string, value: number): string {
  if (type === "percent") return `${value}% off`;
  return `$${(value / 100).toFixed(2)} off`;
}

const inputCls =
  "w-full rounded-xl bg-white/6 border border-white/10 px-3.5 py-3 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60";

function PromoCodeCard({
  promo,
  onCopy,
  onDelete,
}: {
  promo: PromoCode;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const exhausted = promo.max_uses != null && promo.uses_count >= promo.max_uses;
  return (
    <div className="rounded-xl border border-white/10 bg-white/4 p-3.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 active:opacity-60"
        >
          <span className="text-[16px] font-bold tracking-wider text-white">
            {promo.code}
          </span>
          <Copy size={13} className="text-white/40" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${promo.code}`}
          className="shrink-0 active:scale-90"
        >
          <Trash2 size={16} color="#ef4444" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span
          className="rounded-md px-2 py-0.5 text-xs font-semibold"
          style={{ color: ACCENT, backgroundColor: "rgba(63,220,255,0.12)" }}
        >
          {formatDiscount(promo.discount_type, promo.discount_value)}
        </span>
        <span className="text-xs text-white/60">
          {promo.uses_count}
          {promo.max_uses ? ` / ${promo.max_uses}` : ""} used
        </span>
        {exhausted ? (
          <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-400 bg-rose-500/12">
            Exhausted
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EventPromoCodesScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);

  const showToast = useUIStore((s) => s.showToast);
  const queryClient = useQueryClient();

  const {
    showCreate,
    newCode,
    discountType,
    discountValue,
    maxUses,
    setShowCreate,
    setNewCode,
    setDiscountType,
    setDiscountValue,
    setMaxUses,
    resetForm,
  } = usePromoCodesUIStore();

  const pending = useDeleteStore((s) => s.pending);
  const isDeleting = useDeleteStore((s) => s.isDeleting);
  const setPending = useDeleteStore((s) => s.setPending);
  const setIsDeleting = useDeleteStore((s) => s.setIsDeleting);

  // LIST — exact native supabase read.
  const { data, isLoading } = useQuery({
    queryKey: ["event-promo-codes", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<PromoCode[]> => {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PromoCode[];
    },
  });

  const promoCodes = useMemo(() => data ?? [], [data]);

  // CREATE — exact native supabase insert (incl. duplicate 23505 handling).
  const createMutation = useMutation({
    mutationFn: async () => {
      const code = newCode.trim().toUpperCase();
      const numValue =
        discountType === "percent"
          ? parseFloat(discountValue)
          : Math.round(parseFloat(discountValue) * 100); // dollars → cents
      const authId = await getCurrentUserAuthId();
      const { error } = await supabase.from("promo_codes").insert({
        event_id: eventId,
        code,
        discount_type: discountType,
        discount_value: numValue,
        max_uses: maxUses ? parseInt(maxUses) : null,
        created_by: authId,
      });
      if (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((error as any).code === "23505") {
          const dup = new Error("This code already exists");
          (dup as Error & { duplicate?: boolean }).duplicate = true;
          throw dup;
        }
        throw error;
      }
      return code;
    },
    onSuccess: (code) => {
      showToast("success", "Created", `Promo code ${code} created`);
      resetForm();
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["event-promo-codes", eventId] });
    },
    onError: (err: Error & { duplicate?: boolean }) => {
      if (err.duplicate) {
        showToast("error", "Duplicate", "This code already exists");
      } else {
        showToast("error", "Error", err.message || "Failed to create promo code");
      }
    },
  });

  // DELETE — exact native supabase delete.
  const deleteMutation = useMutation({
    mutationFn: async (promoId: string) => {
      const { error } = await supabase
        .from("promo_codes")
        .delete()
        .eq("id", promoId);
      if (error) throw error;
      return promoId;
    },
    onSuccess: () => {
      const code = pending?.code ?? "";
      showToast("success", "Deleted", `Promo code "${code}" deleted`);
      setPending(null);
      setIsDeleting(false);
      queryClient.invalidateQueries({ queryKey: ["event-promo-codes", eventId] });
    },
    onError: () => {
      setIsDeleting(false);
      showToast("error", "Error", "Failed to delete promo code");
    },
  });

  const handleCreate = () => {
    if (!newCode.trim()) {
      showToast("error", "Error", "Enter a promo code");
      return;
    }
    if (!discountValue || parseFloat(discountValue) <= 0) {
      showToast("error", "Error", "Enter a valid discount value");
      return;
    }
    if (discountType === "percent") {
      const v = parseFloat(discountValue);
      if (v < 1 || v > 100) {
        showToast("error", "Error", "Percent discount must be 1-100");
        return;
      }
    }
    createMutation.mutate();
  };

  const handleCopy = (code: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    showToast("info", "Promo Code", code);
  };

  const confirmDelete = () => {
    if (!pending) return;
    setIsDeleting(true);
    deleteMutation.mutate(pending.id);
  };

  // TanStack Virtual over the codes list.
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: promoCodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">Promo Codes</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[#06070d] active:scale-95"
          style={{ backgroundColor: ACCENT }}
        >
          <Plus size={16} color="#06070d" />
          New
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
            <p className="mt-4 text-sm text-white/60">Loading promo codes…</p>
          </div>
        ) : promoCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/6">
              <Tag size={40} color="#666" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">
              No promo codes yet
            </p>
            <p className="max-w-xs text-sm text-white/60">
              Create a promo code to offer discounts to your attendees.
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 180px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const promo = promoCodes[item.index];
                if (!promo) return null;
                return (
                  <div
                    key={promo.id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 10,
                    }}
                  >
                    <PromoCodeCard
                      promo={promo}
                      onCopy={() => handleCopy(promo.code)}
                      onDelete={() => setPending(promo)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Create sheet — kit Dialog + FormField */}
      <Dialog
        open={showCreate}
        onClose={() => {
          if (!createMutation.isPending) {
            resetForm();
            setShowCreate(false);
          }
        }}
        title="New Promo Code"
        footer={
          <>
            <button
              disabled={createMutation.isPending}
              onClick={() => {
                resetForm();
                setShowCreate(false);
              }}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={createMutation.isPending}
              onClick={handleCreate}
              className="flex-1 rounded-xl py-3 font-semibold text-[#06070d] disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label="Code">
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder="CODE (e.g. EARLYBIRD)"
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={20}
              className={`${inputCls} tracking-wider`}
            />
          </FormField>

          <FormField label="Discount Type">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDiscountType("percent")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13px] font-semibold ${
                  discountType === "percent"
                    ? "text-[#06070d]"
                    : "border-white/10 bg-white/6 text-white/60"
                }`}
                style={
                  discountType === "percent"
                    ? { backgroundColor: ACCENT, borderColor: ACCENT }
                    : undefined
                }
              >
                <Percent
                  size={14}
                  color={discountType === "percent" ? "#06070d" : "#9ca3af"}
                />
                Percent
              </button>
              <button
                type="button"
                onClick={() => setDiscountType("fixed_cents")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13px] font-semibold ${
                  discountType === "fixed_cents"
                    ? "text-[#06070d]"
                    : "border-white/10 bg-white/6 text-white/60"
                }`}
                style={
                  discountType === "fixed_cents"
                    ? { backgroundColor: ACCENT, borderColor: ACCENT }
                    : undefined
                }
              >
                <DollarSign
                  size={14}
                  color={discountType === "fixed_cents" ? "#06070d" : "#9ca3af"}
                />
                Fixed ($)
              </button>
            </div>
          </FormField>

          <div className="flex gap-3">
            <FormField label="Value">
              <input
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percent" ? "e.g. 20" : "e.g. 5.00"}
                inputMode="decimal"
                className={inputCls}
              />
            </FormField>
            <FormField label="Max Uses">
              <input
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="∞"
                inputMode="numeric"
                className={inputCls}
              />
            </FormField>
          </div>
        </div>
      </Dialog>

      {/* Delete confirm — kit Dialog (native Alert.alert parity) */}
      <Dialog
        open={!!pending}
        onClose={() => {
          if (!isDeleting) setPending(null);
        }}
        title="Delete Promo Code"
        footer={
          <>
            <button
              disabled={isDeleting}
              onClick={() => setPending(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isDeleting}
              onClick={confirmDelete}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Delete &quot;{pending?.code}&quot;? This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}

export default EventPromoCodesScreen;
