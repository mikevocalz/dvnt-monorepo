"use client";

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { Mail, Phone, Trash2, Pencil, X } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAccountUIStore } from "@dvnt/app/lib/stores/account-ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { deleteAccountPrivileged } from "@dvnt/app/lib/supabase/privileged";

/**
 * Account Information — web (Phase 1 port of native `app/settings/account.tsx`).
 * Law 1 (data is sacred): identical data flow — auth user from `useAuthStore`
 * (user, setUser, logout); name save via `usersApi.updateProfile` then
 * `setUser`; account deletion via `deleteAccountPrivileged` then `logout` +
 * redirect to /login. Toasts mirror native through `useUIStore.showToast`.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off), sticky
 * header titled "Account Information" like legal-page.web.tsx, rounded cards,
 * rows with bottom borders, destructive actions in rose/red, kit `Dialog` for
 * the destructive delete confirmation. Local UI state lives in a Zustand store
 * (`account-ui-store`) — never useState.
 */
export function AccountScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const showToast = useUIStore((s) => s.showToast);

  const {
    isEditing,
    name,
    isSaving,
    isDeleting,
    showDeleteConfirm,
    deleteConfirmText,
    setIsEditing,
    setName,
    setIsSaving,
    setIsDeleting,
    setShowDeleteConfirm,
    setDeleteConfirmText,
  } = useAccountUIStore();

  // Hydrate the name draft from the authed user on mount / user change.
  useEffect(() => {
    setName(user?.name || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, setName]);

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("error", "Name is required");
      return;
    }
    setIsSaving(true);
    try {
      await usersApi.updateProfile({ name: name.trim() });
      if (user) {
        setUser({ ...user, name: name.trim() });
      }
      setIsEditing(false);
      showToast("success", "Profile updated");
    } catch (error: any) {
      showToast("error", "Failed to save", error?.message || "Please try again");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmText("");
    setShowDeleteConfirm(true);
  };

  const handleConfirmDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== "DELETE") {
      showToast("error", "Account deletion cancelled", "You must type DELETE to confirm");
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccountPrivileged();
      showToast(
        "success",
        "Account deleted",
        "Your account and all associated data have been permanently deleted.",
      );
      setShowDeleteConfirm(false);
      logout();
      router.replace("/login");
    } catch (err: any) {
      showToast("error", "Failed to delete account", err?.message || "Something went wrong");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky top bar; Save/Pencil toggle + close X mirror native headerRight */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Account Information</h1>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-[16px] font-semibold text-cyan-400 disabled:text-white/40"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              aria-label="Edit"
              className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
            >
              <Pencil size={20} color="#fff" />
            </button>
          )}
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
          >
            <X size={18} color="#fff" />
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {/* Personal Information card */}
        <div className="rounded-2xl bg-white/4 border border-white/10 p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Personal Information</h2>

          {/* Name */}
          <div className="mb-4">
            <p className="mb-2 text-sm text-white/60">Name</p>
            {isEditing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="w-full rounded-xl border border-cyan-500/50 bg-white/6 px-4 py-3 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60"
              />
            ) : (
              <div className="flex items-center rounded-xl border border-white/10 bg-white/6 px-4 py-3">
                <span className="flex-1 text-white">{user?.name || "Not set"}</span>
              </div>
            )}
          </div>

          {/* Username */}
          <div className="mb-4">
            <p className="mb-2 text-sm text-white/60">Username</p>
            <div className="flex items-center rounded-xl border border-white/10 bg-white/6 px-4 py-3">
              <span className="flex-1 text-white">@{user?.username || "Not set"}</span>
            </div>
            <p className="mt-1 text-xs text-white/50">Username can be changed from Edit Profile</p>
          </div>

          {/* Email */}
          <div className="mb-4">
            <p className="mb-2 text-sm text-white/60">Email</p>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/6 px-4 py-3">
              <Mail size={18} className="text-white/40 shrink-0" />
              <span className="flex-1 text-white">{user?.email || "Not set"}</span>
            </div>
          </div>

          {/* Phone */}
          <div>
            <p className="mb-2 text-sm text-white/60">Phone</p>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/6 px-4 py-3">
              <Phone size={18} className="text-white/40 shrink-0" />
              <span className="flex-1 text-white/60">Not linked</span>
            </div>
          </div>
        </div>

        {/* Delete Account (destructive) */}
        <button
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 py-4 active:bg-rose-500/20 disabled:opacity-50"
        >
          <Trash2 size={20} color="#ef4444" />
          <span className="font-semibold text-rose-400">
            {isDeleting ? "Deleting..." : "Delete Account"}
          </span>
        </button>

        <p className="mt-4 text-center text-xs text-white/50">
          Deleting your account is permanent and cannot be undone.
        </p>
      </main>

      {/* Delete confirmation — kit Dialog */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => {
          if (!isDeleting) setShowDeleteConfirm(false);
        }}
        title="Delete Account"
        footer={
          <>
            <button
              disabled={isDeleting}
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isDeleting || deleteConfirmText.trim() !== "DELETE"}
              onClick={handleConfirmDeleteAccount}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          This permanently deletes your DVNT account, ends active Lynk rooms you host, deregisters
          push tokens, and removes or anonymizes associated data required for bookkeeping.
        </p>
        <p className="mt-5 text-sm font-medium text-white">Type DELETE to confirm</p>
        <input
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder="DELETE"
          autoCapitalize="characters"
          disabled={isDeleting}
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/6 px-4 py-3 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60 disabled:opacity-50"
        />
      </Dialog>
    </div>
  );
}
