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
import {
  getEventStaff,
  inviteCoOrganizer,
  revokeCoOrganizer,
  type StaffEntry,
  type CoOrgRole,
} from "@dvnt/app/lib/api/privileged";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
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
  usernameInput: string;
  roleInput: CoOrgRole;
  removeTarget: StaffEntry | null;
  openInvite: () => void;
  closeInvite: () => void;
  setUsernameInput: (v: string) => void;
  setRoleInput: (v: CoOrgRole) => void;
  setRemoveTarget: (s: StaffEntry | null) => void;
  reset: () => void;
}

const useStaffUIStore = create<StaffUIState>((set) => ({
  inviteOpen: false,
  usernameInput: "",
  roleInput: "scanner",
  removeTarget: null,
  openInvite: () => set({ inviteOpen: true }),
  closeInvite: () => set({ inviteOpen: false }),
  setUsernameInput: (v) => set({ usernameInput: v }),
  setRoleInput: (v) => set({ roleInput: v }),
  setRemoveTarget: (s) => set({ removeTarget: s }),
  reset: () => set({ inviteOpen: false, usernameInput: "", roleInput: "scanner" }),
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
  const usernameInput = useStaffUIStore((s) => s.usernameInput);
  const roleInput = useStaffUIStore((s) => s.roleInput);
  const removeTarget = useStaffUIStore((s) => s.removeTarget);
  const openInvite = useStaffUIStore((s) => s.openInvite);
  const closeInvite = useStaffUIStore((s) => s.closeInvite);
  const setUsernameInput = useStaffUIStore((s) => s.setUsernameInput);
  const setRoleInput = useStaffUIStore((s) => s.setRoleInput);
  const setRemoveTarget = useStaffUIStore((s) => s.setRemoveTarget);
  const reset = useStaffUIStore((s) => s.reset);

  const staffQuery = useQuery({
    queryKey: ["event-staff", eventId],
    queryFn: () => getEventStaff(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 5_000,
  });

  const inviteMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: CoOrgRole }) =>
      inviteCoOrganizer(eventId, username, role),
    onSuccess: (res) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((res as any)?.error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        showToast("error", "Invite failed", String((res as any).error));
        return;
      }
      showToast(
        "success",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res as any)?.reinvited ? "Re-invited" : "Invite sent",
        `Pushed @${usernameInput}.`,
      );
      reset();
      queryClient.invalidateQueries({ queryKey: ["event-staff", eventId] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      showToast(
        "error",
        "Invite failed",
        err?.message || "Try a different username.",
      );
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

  const onInviteSubmit = () => {
    const u = usernameInput.trim().replace(/^@/, "");
    if (!u) {
      showToast("error", "Username required", "");
      return;
    }
    inviteMutation.mutate({ username: u, role: roleInput });
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
        <h1 className="text-[17px] font-semibold">Staff</h1>
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

      {/* Invite — kit Dialog with username + role select + send. */}
      <Dialog
        open={inviteOpen && canManage}
        onClose={() => {
          if (!inviteMutation.isPending) closeInvite();
        }}
        title="Invite staff"
        footer={
          <>
            <button
              disabled={inviteMutation.isPending}
              onClick={closeInvite}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={inviteMutation.isPending}
              onClick={onInviteSubmit}
              className="flex-1 rounded-xl bg-[#3FDCFF] py-3 font-semibold text-black disabled:opacity-60"
            >
              {inviteMutation.isPending ? "Sending…" : "Send invite"}
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
          <span className="text-[17px] font-semibold text-white/50">@</span>
          <input
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={inviteMutation.isPending}
            className="flex-1 bg-transparent text-[17px] text-white placeholder:text-white/35 outline-none disabled:opacity-50"
          />
        </div>

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
