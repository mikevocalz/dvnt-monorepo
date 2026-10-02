"use client";

/**
 * Event Staff Management — web (port of native
 * `app/(protected)/events/[id]/staff.tsx`).
 *
 * Law 1 (data is sacred): identical data flow to native. The list comes from
 * `getEventStaff(eventId)` via TanStack Query; invite via
 * `inviteCoOrganizer(eventId, username, role)`; remove/revoke via
 * `revokeCoOrganizer(inviteId)` — the EXACT privileged wrappers native imports
 * from `@dvnt/app/lib/api/privileged`. Toasts mirror native through
 * `useUIStore.showToast`. Same query key `["event-staff", eventId]`, same
 * accepted/pending grouping, same canManage gating, same role color map via
 * `tierAccent`.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). Sticky
 * header titled "Staff". Content max-w-2xl, bg #06070d, accent cyan #3FDCFF.
 * Avatars are rounded squares (never circles). Lists = TanStack Virtual over a
 * scroll container (project rule — never FlatList/FlashList). Local UI state
 * (invite dialog open, username draft, role draft, remove-confirm target) lives
 * in a tiny Zustand store — never useState. Kit `Dialog` powers the invite form
 * and the remove confirmation.
 */

import { useMemo, useRef } from "react";
import { create } from "zustand";
import { useParams, useRouter } from "solito/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  UserPlus,
  Shield,
  ShieldCheck,
  ScanLine,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addCoOrganizer,
  getEventStaff,
  revokeCoOrganizer,
  type StaffEntry,
  type CoOrgRole,
} from "@dvnt/app/lib/api/privileged";
import { UserPicker } from "./ui/user-picker.web";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { DoorModeTabs } from "./door-mode-tabs.web";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import { Dialog } from "@dvnt/ui";

const ROLE_OPTIONS: { value: CoOrgRole; label: string; description: string }[] = [
  {
    value: "scanner",
    label: "Scanner",
    description: "Check tickets in at the door. PII-redacted roster.",
  },
  {
    value: "editor",
    label: "Manager",
    description: "Scanner + full roster + refunds + analytics.",
  },
  {
    value: "admin",
    label: "Co-host",
    description: "Manager + invite other staff. Owner-only to grant.",
  },
];

function roleColor(role: StaffEntry["role"]): string {
  switch (role) {
    case "owner":
      return tierAccent("table"); // magenta
    case "admin":
      return tierAccent("vip"); // purple
    case "editor":
      return tierAccent("ga"); // primary cyan
    case "scanner":
    default:
      return tierAccent("free"); // bright cyan
  }
}

function roleLabel(role: StaffEntry["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Co-host";
    case "editor":
      return "Manager";
    case "scanner":
    default:
      return "Scanner";
  }
}

function RoleIcon({ role, size = 16 }: { role: StaffEntry["role"]; size?: number }) {
  const color = roleColor(role);
  if (role === "owner" || role === "admin")
    return <ShieldCheck size={size} color={color} />;
  if (role === "editor") return <Shield size={size} color={color} />;
  return <ScanLine size={size} color={color} />;
}

// --- Local UI state (Zustand, never useState) -----------------------------
interface StaffUIState {
  inviteOpen: boolean;
  pickerQuery: string;
  selectedUser: { id: string; username: string; name: string; avatar: string } | null;
  roleInput: CoOrgRole;
  removeTarget: StaffEntry | null;
  openInvite: () => void;
  closeInvite: () => void;
  setPickerQuery: (v: string) => void;
  setSelectedUser: (u: StaffUIState["selectedUser"]) => void;
  setRoleInput: (v: CoOrgRole) => void;
  setRemoveTarget: (s: StaffEntry | null) => void;
  reset: () => void;
}

const useStaffUIStore = create<StaffUIState>((set) => ({
  inviteOpen: false,
  pickerQuery: "",
  selectedUser: null,
  roleInput: "scanner",
  removeTarget: null,
  openInvite: () => set({ inviteOpen: true }),
  closeInvite: () => set({ inviteOpen: false }),
  setPickerQuery: (v) => set({ pickerQuery: v }),
  setSelectedUser: (u) => set({ selectedUser: u }),
  setRoleInput: (v) => set({ roleInput: v }),
  setRemoveTarget: (s) => set({ removeTarget: s }),
  reset: () =>
    set({
      inviteOpen: false,
      pickerQuery: "",
      selectedUser: null,
      roleInput: "scanner",
    }),
}));

const ROW_HEIGHT = 76; // 64px row + 12px gap

function StaffRow({
  staff,
  canManage,
  onRemove,
  pending = false,
}: {
  staff: StaffEntry;
  canManage: boolean;
  onRemove: () => void;
  pending?: boolean;
}) {
  const handle = staff.username
    ? `@${staff.username}`
    : staff.authId.slice(0, 8);
  const name = staff.displayName || handle;
  const accent = roleColor(staff.role);

  return (
    <div className="flex items-center gap-3 px-1 py-2">
      {/* Avatar — rounded square, never a circle. Initial only (mirrors native). */}
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
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
          style={{ borderColor: accent, color: accent }}
        >
          <RoleIcon role={staff.role} size={11} />
          {roleLabel(staff.role)}
        </span>
        {pending ? (
          <span className="text-[11px] text-white/40">Awaiting accept</span>
        ) : null}
      </div>
      {canManage ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/50 transition-colors active:bg-white/8"
        >
          <X size={16} color="rgba(255,255,255,0.5)" />
        </button>
      ) : (
        <span className="w-9 shrink-0" />
      )}
    </div>
  );
}

export function EventStaffScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);

  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const inviteOpen = useStaffUIStore((s) => s.inviteOpen);
  const pickerQuery = useStaffUIStore((s) => s.pickerQuery);
  const selectedUser = useStaffUIStore((s) => s.selectedUser);
  const roleInput = useStaffUIStore((s) => s.roleInput);
  const removeTarget = useStaffUIStore((s) => s.removeTarget);
  const openInvite = useStaffUIStore((s) => s.openInvite);
  const closeInvite = useStaffUIStore((s) => s.closeInvite);
  const setPickerQuery = useStaffUIStore((s) => s.setPickerQuery);
  const setSelectedUser = useStaffUIStore((s) => s.setSelectedUser);
  const setRoleInput = useStaffUIStore((s) => s.setRoleInput);
  const setRemoveTarget = useStaffUIStore((s) => s.setRemoveTarget);
  const reset = useStaffUIStore((s) => s.reset);

  const staffQuery = useQuery({
    queryKey: ["event-staff", eventId],
    queryFn: () => getEventStaff(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 5_000,
  });

  const addMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: CoOrgRole }) =>
      addCoOrganizer(eventId, username, role),
    onSuccess: (res, vars) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((res as any)?.error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toast.error(String((res as any).error));
        return;
      }
      // Secondary confirmation — the event_co_organizers row + the
      // in-app/push notification are the record; this toast is the
      // "done" flash for the person who tapped Add.
      toast.success(`@${vars.username} added to staff`, {
        description: "They've been notified.",
      });
      reset();
      queryClient.invalidateQueries({ queryKey: ["event-staff", eventId] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      toast.error(err?.message || "Couldn't add them — try a different person.");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeCoOrganizer(inviteId),
    onSuccess: () => {
      showToast("success", "Staff removed", "");
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["event-staff", eventId] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      showToast("error", "Couldn't remove", err?.message || "Try again.");
    },
  });

  const staff = staffQuery.data?.staff || [];
  const callerRole = staffQuery.data?.callerRole || null;
  const canManage = callerRole === "owner" || callerRole === "admin";

  const grouped = useMemo(() => {
    const accepted = staff.filter((s) => s.accepted);
    const pending = staff.filter((s) => !s.accepted);
    return { accepted, pending };
  }, [staff]);

  // Flatten into a single virtualized list with section header rows so the
  // whole roster (pending + accepted) virtualizes as one scroll container.
  type ListItem =
    | { kind: "section"; key: string; label: string }
    | { kind: "row"; key: string; staff: StaffEntry; pending: boolean };

  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    if (grouped.pending.length > 0) {
      out.push({ kind: "section", key: "sec-pending", label: "Pending invites" });
      for (const s of grouped.pending) {
        out.push({
          kind: "row",
          key: s.inviteId ?? s.authId,
          staff: s,
          pending: true,
        });
      }
    }
    out.push({ kind: "section", key: "sec-staff", label: "Staff" });
    for (const s of grouped.accepted) {
      out.push({
        kind: "row",
        key: s.inviteId ?? s.authId,
        staff: s,
        pending: false,
      });
    }
    return out;
  }, [grouped]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]?.kind === "section" ? 44 : ROW_HEIGHT),
    overscan: 8,
  });

  const onAddSubmit = () => {
    if (!selectedUser) {
      toast.error("Pick a person first");
      return;
    }
    addMutation.mutate({ username: selectedUser.username, role: roleInput });
  };

  // canManage gating for a given row mirrors native: owner rows are never
  // removable; admins can only be removed by the owner.
  const rowCanManage = (s: StaffEntry) =>
    canManage &&
    s.role !== "owner" &&
    (callerRole === "owner" || s.role !== "admin");

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky "Staff", back arrow + invite action (mirror native). */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <DoorModeTabs
          eventId={String(eventId)}
          role={callerRole as never}
          active="staff"
        />
        {canManage ? (
          <button
            onClick={openInvite}
            aria-label="Invite staff"
            className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
          >
            <UserPlus size={20} color="#fff" />
          </button>
        ) : (
          <span className="w-9" />
        )}
      </div>

      {staffQuery.isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading staff…</p>
        </div>
      ) : staffQuery.isError ? (
        <main className="mx-auto w-full max-w-2xl px-8 py-24">
          <p className="text-center text-sm text-white/40">
            Couldn&apos;t load staff. Refresh to retry.
          </p>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 py-6">
          {/* The page's whole purpose, as a labelled action rather than a 36px
              glyph in a corner. The header icon stays for anyone who already
              knows where it is; this is for everyone else. When there is no
              staff yet it is the only thing on screen, because an empty roster
              is an invitation to add someone, not a dead end. */}
          {canManage ? (
            <button
              type="button"
              onClick={openInvite}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3FDCFF] py-3 text-[15px] font-bold text-black active:scale-[0.99]"
            >
              <UserPlus size={18} color="#000" aria-hidden />
              Add staff member
            </button>
          ) : (
            // Not a blank spacer. Someone looking for this button deserves to
            // know why it is missing rather than assume the page is broken.
            <p className="mb-4 rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-[13px] leading-relaxed text-white/50">
              Only the event owner or an admin can add staff. Ask them to invite
              you as an admin if you need to manage this list.
            </p>
          )}

          {staff.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-white/4 px-6 py-10 text-center">
              <Shield size={28} color="rgba(255,255,255,0.25)" aria-hidden />
              <p className="mt-3 text-[15px] font-semibold text-white">
                No staff yet
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/50">
                {canManage
                  ? "Add someone as a scanner and they can check guests in at the door."
                  : "Nobody has been added to work this door yet."}
              </p>
            </div>
          ) : null}

          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100svh - 140px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = items[vItem.index];
                if (!item) return null;
                return (
                  <div
                    key={item.key}
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
                    {item.kind === "section" ? (
                      <p className="px-1 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                        {item.label}
                      </p>
                    ) : (
                      <StaffRow
                        staff={item.staff}
                        canManage={rowCanManage(item.staff)}
                        pending={item.pending}
                        onRemove={() => setRemoveTarget(item.staff)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* Add — kit Dialog with user picker + role select + add. */}
      <Dialog
        open={inviteOpen && canManage}
        onClose={() => {
          if (!addMutation.isPending) closeInvite();
        }}
        title="Add staff"
        footer={
          <>
            <button
              disabled={addMutation.isPending}
              onClick={closeInvite}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={addMutation.isPending || !selectedUser}
              onClick={onAddSubmit}
              className="flex-1 rounded-xl bg-[#3FDCFF] py-3 font-semibold text-black disabled:opacity-60"
            >
              {addMutation.isPending ? "Adding…" : "Add to staff"}
            </button>
          </>
        }
      >
        <UserPicker
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          selected={selectedUser}
          onSelect={(u) => setSelectedUser(u)}
          onClear={() => setSelectedUser(null)}
          placeholder="Search DVNT members…"
          disabled={addMutation.isPending}
        />
        <p className="mt-2 text-[11px] text-white/35">
          They&apos;re added right away and notified — no accept step.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {ROLE_OPTIONS.map((opt) => {
            const selected = roleInput === opt.value;
            const disabled = opt.value === "admin" && callerRole !== "owner";
            const accent = roleColor(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => !disabled && setRoleInput(opt.value)}
                disabled={disabled}
                className="rounded-xl border bg-white/2 p-3 text-left disabled:opacity-40"
                style={
                  selected
                    ? { borderColor: accent, backgroundColor: `${accent}22` }
                    : { borderColor: "rgba(255,255,255,0.08)" }
                }
              >
                <p
                  className="text-[15px] font-semibold"
                  style={{ color: selected ? accent : "#fff" }}
                >
                  {opt.label}
                </p>
                <p className="mt-1 text-[13px] text-white/50">{opt.description}</p>
                {disabled ? (
                  <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/30">
                    Owner only
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      </Dialog>

      {/* Remove confirmation — kit Dialog. */}
      <Dialog
        open={!!removeTarget}
        onClose={() => {
          if (!revokeMutation.isPending) setRemoveTarget(null);
        }}
        title="Remove staff"
        footer={
          <>
            <button
              disabled={revokeMutation.isPending}
              onClick={() => setRemoveTarget(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={revokeMutation.isPending || !removeTarget?.inviteId}
              onClick={() => {
                if (removeTarget?.inviteId)
                  revokeMutation.mutate(removeTarget.inviteId);
              }}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {revokeMutation.isPending ? "Removing…" : "Remove"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Remove{" "}
          <span className="font-semibold text-white">
            {removeTarget?.displayName ||
              (removeTarget?.username ? `@${removeTarget.username}` : "this person")}
          </span>{" "}
          from event staff? They&apos;ll lose access immediately.
        </p>
      </Dialog>
    </div>
  );
}

export default EventStaffScreen;
