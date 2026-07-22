"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { Camera, ChevronRight, Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import { FormField, StickySaveBar, useDirtyGuard } from "@dvnt/ui";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useProfileStore } from "@dvnt/app/lib/stores/profile-store";
import { useUpdateProfile } from "@dvnt/app/lib/hooks/use-profile";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { appendCacheBuster } from "@dvnt/app/lib/media/resolveAvatarUrl";
import { useEditProfileUIStore } from "@dvnt/app/lib/stores/edit-profile-ui-store";
import { IDENTITY_OPTIONS, AUDIENCE_OPTIONS } from "@dvnt/app/lib/constants/identity";
import { supabase } from "@dvnt/app/lib/supabase/client";

const PRONOUNS_OPTIONS = ["He/Him", "She/Her", "They/Them", "He/They", "She/They", "Ze/Zir", "Custom"];
const GENDER_OPTIONS = ["Male", "Female", "Trans Male", "Trans Female", "Non-binary", "Prefer not to say", "Custom"];

function sanitizeLinks(value: unknown[]): string[] {
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeLinks(value: unknown): string[] {
  if (Array.isArray(value)) return sanitizeLinks(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return sanitizeLinks(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [];
}

const validateUsername = (value: string): string => {
  if (!value.trim()) return "Username is required";
  if (value.length < 3) return "Must be at least 3 characters";
  if (value.length > 30) return "Must be 30 characters or less";
  if (!/^[a-zA-Z0-9_]+$/.test(value)) return "Only letters, numbers, and underscores";
  return "";
};

const inputCls =
  "w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60";

/**
 * Edit Profile — web (Phase 1 reference port of `(protected)/edit-profile.tsx`).
 * Law 1: faithful to the native data flow (auth user → profile-store text fields +
 * edit-profile-ui-store transient state → `useUpdateProfile` mutation + avatar via
 * `useMediaUpload`). Law 3: labeled `FormField`s, content column, `StickySaveBar`
 * + `useDirtyGuard`, file-input avatar, rounded-SQUARE avatar (never circular).
 */
export function EditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const updateProfile = useUpdateProfile();
  const { uploadSingle, isUploading, progress } = useMediaUpload({ folder: "avatars", userId: user?.id });
  const fileRef = useRef<HTMLInputElement>(null);

  const { editName, editBio, editWebsite, editLocation, setEditName, setEditBio, setEditWebsite, setEditLocation } =
    useProfileStore();
  const s = useEditProfileUIStore();

  // Hydrate text + transient state from the authed user on mount / user change.
  useEffect(() => {
    if (user) {
      setEditName(user.name || "");
      setEditBio(user.bio || "");
      setEditWebsite(user.website || "");
      setEditLocation(user.location || "");
      s.hydrate({
        username: user.username || "",
        pronouns: typeof user.pronouns === "string" ? user.pronouns : "",
        gender: typeof user.gender === "string" ? user.gender : "",
        links: normalizeLinks((user as any)?.links),
        sexuality: Array.isArray(user.sexuality) ? user.sexuality : [],
        eventAudience: user.eventAudience || "",
      });
      // The auth store only carries sexuality/event_audience after they've
      // been saved this session — refresh both from the row so the form (and
      // the dirty baseline) reflect what's actually stored.
      //
      // GUARDED: this effect depends on `user`, and updateUser mints a new
      // user object — an unconditional updateUser here re-ran the effect,
      // which re-hydrated (wiping whatever the person had typed) and fetched
      // again, forever. That was the "screen jumping / nothing saves" bug.
      // Only write back when the row actually differs from the store.
      void supabase
        .from("users")
        .select("sexuality, event_audience")
        .eq("id", Number(user.id))
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const sexuality = Array.isArray(data.sexuality) ? data.sexuality : [];
          const eventAudience = data.event_audience || "";
          const cur = useAuthStore.getState().user;
          const changed =
            !!cur &&
            (JSON.stringify(cur.sexuality ?? []) !== JSON.stringify(sexuality) ||
              (cur.eventAudience ?? "") !== eventAudience);
          if (changed) {
            useAuthStore.getState().updateUser({ sexuality, eventAudience });
            s.setSexuality(sexuality);
            s.setEventAudience(eventAudience);
          }
        });
      return;
    }
    s.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const isDirty =
    !!user &&
    (editName.trim() !== (user.name || "") ||
      editBio.trim() !== (user.bio || "") ||
      editWebsite.trim() !== (user.website || "") ||
      editLocation.trim() !== (user.location || "") ||
      s.username !== (user.username || "") ||
      s.pronouns !== (typeof user.pronouns === "string" ? user.pronouns : "") ||
      s.gender !== (typeof user.gender === "string" ? user.gender : "") ||
      JSON.stringify(s.sexuality) !== JSON.stringify(user.sexuality || []) ||
      s.eventAudience !== (user.eventAudience || "") ||
      JSON.stringify(s.links) !== JSON.stringify(normalizeLinks((user as any)?.links)) ||
      !!s.newAvatarUri);
  useDirtyGuard(isDirty);

  const handleUsernameChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    s.setUsername(cleaned);
    s.setUsernameError(validateUsername(cleaned));
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    s.setNewAvatarUri(URL.createObjectURL(file));
  };

  const addLink = () => {
    const trimmed = s.newLink.trim();
    if (!trimmed) return;
    if (s.links.length >= 4) {
      showToast("warning", "Limit", "You can add up to 4 links");
      return;
    }
    s.setLinks((prev) => [...prev, trimmed]);
    s.setNewLink("");
  };

  const removeLink = (index: number) => s.setLinks((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!user) {
      showToast("error", "Error", "User not found");
      return;
    }
    s.setIsSaving(true);
    try {
      let avatarUrl = user.avatar;
      if (s.newAvatarUri) {
        try {
          const uploadResult = await uploadSingle(s.newAvatarUri);
          if (uploadResult.success && uploadResult.url) {
            avatarUrl = appendCacheBuster(uploadResult.url) || uploadResult.url;
          } else {
            showToast("warning", "Upload Issue", "Avatar upload failed. Other changes will be saved.");
          }
        } catch {
          showToast("warning", "Upload Issue", "Avatar upload failed. Other changes will be saved.");
        }
      }

      const trimmedUsername = s.username.trim().toLowerCase();
      const usernameErr = validateUsername(trimmedUsername);
      if (usernameErr) {
        s.setUsernameError(usernameErr);
        s.setIsSaving(false);
        return;
      }

      const allLinks = Array.from(
        new Set([...(editWebsite.trim() ? [editWebsite.trim()] : []), ...normalizeLinks(s.links)]),
      ).slice(0, 4);

      const updateData: Record<string, unknown> = {
        name: editName.trim(),
        bio: editBio.trim(),
        website: editWebsite.trim(),
        links: allLinks,
        location: editLocation.trim(),
        pronouns: s.pronouns.trim(),
        gender: s.gender.trim(),
        sexuality: s.sexuality,
        eventAudience: s.eventAudience,
        ...(avatarUrl ? { avatar: avatarUrl } : {}),
        ...(trimmedUsername !== (user.username || "").toLowerCase() ? { username: trimmedUsername } : {}),
      };

      updateProfile.mutate(updateData as any, {
        onSuccess: () => showToast("success", "Saved", "Profile updated successfully"),
        onError: (error: any) =>
          showToast("error", "Error", error?.message || "Failed to save profile. Please try again."),
      });
      router.back();
    } catch (error: any) {
      showToast("error", "Error", error?.message || "Failed to save profile. Please try again.");
      s.setIsSaving(false);
    }
  };

  const avatarSrc = s.newAvatarUri || user?.avatar || "";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button onClick={() => router.back()} className="text-[16px] text-white/80 active:opacity-60">
          Cancel
        </button>
        <h1 className="text-[17px] font-semibold">Edit Profile</h1>
        <button
          onClick={handleSave}
          disabled={s.isSaving}
          className="text-[16px] font-semibold text-cyan-400 disabled:text-white/40"
        >
          {s.isSaving ? "Saving…" : "Done"}
        </button>
      </div>

      <div className="mx-auto w-full max-w-xl px-4 pb-32">
        {/* Avatar — rounded square, never circular */}
        <div className="flex flex-col items-center py-6">
          <button onClick={() => fileRef.current?.click()} className="relative">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt="" className="w-24 h-24 rounded-2xl object-cover bg-white/8" />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-white/8 flex items-center justify-center text-2xl font-bold text-white/40">
                {(user?.username || "U").slice(0, 1).toUpperCase()}
              </div>
            )}
            {isUploading ? (
              <div className="absolute inset-0 rounded-2xl bg-black/50 flex flex-col items-center justify-center">
                <span className="text-white text-xs">{Math.round(progress)}%</span>
              </div>
            ) : (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-cyan-500 border-[3px] border-[#06070d] flex items-center justify-center">
                <Camera size={14} color="#fff" />
              </div>
            )}
          </button>
          <button onClick={() => fileRef.current?.click()} className="mt-3 text-sm font-semibold text-cyan-400">
            Change Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
        </div>

        {/* About You */}
        <SectionLabel>About You</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 p-4 flex flex-col gap-4">
          <FormField label="Name" htmlFor="ep-name">
            <input
              id="ep-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Your name"
              maxLength={100}
              className={inputCls}
            />
          </FormField>

          <FormField label="Username" htmlFor="ep-username" error={s.usernameError || undefined}>
            <input
              id="ep-username"
              value={s.username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={30}
              className={inputCls}
            />
          </FormField>

          <FormField label="Pronouns">
            <button
              onClick={() => s.setShowPronouns(!s.showPronouns)}
              className="w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 flex items-center justify-between text-[15px]"
            >
              <span className={s.pronouns ? "text-white" : "text-white/35"}>{s.pronouns || "Add pronouns"}</span>
              <ChevronRight size={16} className="text-white/40" />
            </button>
            {s.showPronouns ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {PRONOUNS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      s.setPronouns(opt === s.pronouns ? "" : opt);
                      if (opt !== "Custom") s.setShowPronouns(false);
                    }}
                    className={`px-3.5 h-9 rounded-xl text-[13px] font-medium ${
                      s.pronouns === opt ? "bg-cyan-500 text-white" : "bg-white/8 text-white/85"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
            {s.showPronouns && s.pronouns === "Custom" ? (
              <input
                value=""
                onChange={(e) => s.setPronouns(e.target.value)}
                placeholder="Enter your pronouns"
                className={`${inputCls} mt-2`}
              />
            ) : null}
          </FormField>

          <FormField label="Bio" htmlFor="ep-bio" description={`${editBio.length}/150`}>
            <textarea
              id="ep-bio"
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              placeholder="Write something about yourself..."
              maxLength={150}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/10 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60 resize-none"
            />
          </FormField>

          <FormField label="Gender">
            <button
              onClick={() => s.setShowGender(!s.showGender)}
              className="w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 flex items-center justify-between text-[15px]"
            >
              <span className={s.gender ? "text-white" : "text-white/35"}>{s.gender || "Prefer not to say"}</span>
              <ChevronRight size={16} className="text-white/40" />
            </button>
            {s.showGender ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      s.setGender(opt === s.gender ? "" : opt);
                      if (opt !== "Custom") s.setShowGender(false);
                    }}
                    className={`px-3.5 h-9 rounded-xl text-[13px] font-medium ${
                      s.gender === opt ? "bg-cyan-500 text-white" : "bg-white/8 text-white/85"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
          </FormField>

          <FormField label="I am">
            <p className="text-xs text-white/40 pb-1">
              Private — used only to tune your events and feed.
            </p>
            <div className="flex flex-wrap gap-2">
              {IDENTITY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => s.toggleSexuality(opt)}
                  className={`px-3.5 h-9 rounded-xl text-[13px] font-medium ${
                    s.sexuality.includes(opt) ? "bg-cyan-500 text-white" : "bg-white/8 text-white/85"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="Looking for events with">
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => s.setEventAudience(opt === s.eventAudience ? "" : opt)}
                  className={`px-3.5 h-9 rounded-xl text-[13px] font-medium ${
                    s.eventAudience === opt ? "bg-cyan-500 text-white" : "bg-white/8 text-white/85"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </FormField>
        </div>

        {/* Links */}
        <SectionLabel className="mt-6">Links</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <LinkIcon size={18} className="text-white/40 shrink-0" />
            <input
              value={editWebsite}
              onChange={(e) => setEditWebsite(e.target.value)}
              placeholder="Website"
              autoCapitalize="none"
              className={inputCls}
            />
          </div>
          {s.links.map((link, index) => (
            <div key={index} className="flex items-center gap-3">
              <LinkIcon size={18} className="text-white/40 shrink-0" />
              <span className="flex-1 text-[15px] text-white truncate">{link}</span>
              <button onClick={() => removeLink(index)} className="shrink-0">
                <Trash2 size={18} color="#ef4444" />
              </button>
            </div>
          ))}
          {s.links.length < 4 ? (
            <div className="flex items-center gap-3">
              <Plus size={18} className="text-cyan-400 shrink-0" />
              <input
                value={s.newLink}
                onChange={(e) => s.setNewLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addLink();
                }}
                placeholder="Add link"
                autoCapitalize="none"
                className={inputCls}
              />
            </div>
          ) : null}
        </div>

        {/* Location */}
        <SectionLabel className="mt-6">Location</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 p-4">
          <input
            value={editLocation}
            onChange={(e) => setEditLocation(e.target.value)}
            placeholder="Add your city or location"
            maxLength={100}
            className={inputCls}
          />
        </div>
      </div>

      <StickySaveBar visible={isDirty} onSave={handleSave} onCancel={() => router.back()} saving={s.isSaving} />
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-wider text-white/40 mb-2 ${className ?? ""}`}>
      {children}
    </p>
  );
}
