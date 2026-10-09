"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ImagePlus, LoaderCircle } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { updateProfile, syncAuthUser } from "@dvnt/app/lib/api/privileged";
import { fetchNewMemberProgress } from "@dvnt/app/lib/profile/new-member-progress";

export default function NewMemberPhotoPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uploadSingle } = useMediaUpload({ folder: "avatars", userId: user?.id });

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void fetchNewMemberProgress().then((status) => {
      if (cancelled) return;
      if (status.step === "first_post") router.replace("/feed/create");
      if (status.step === "complete" || status.step === "not_required") router.replace("/feed");
    }).catch(() => { /* user can still select/upload and retry */ });
    return () => { cancelled = true; };
  }, [user?.id, router]);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a JPEG, PNG, or another supported image.");
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
  };

  const savePhoto = async () => {
    if (!preview || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Reuse the same avatar upload pipeline as the regular Edit Profile page.
      const upload = await uploadSingle(preview);
      if (!upload.success || !upload.url)
        throw new Error(upload.error || "Photo upload failed. Please try again.");
      await updateProfile({ avatarUrl: upload.url });
      // The upload is NOT a completed step until both the saved media row and
      // the real avatar URL can be read back from the server on this account.
      const status = await fetchNewMemberProgress();
      if (!status.hasPhoto || status.step === "photo")
        throw new Error("Your photo hasn't finished saving. Please retry before continuing.");
      try {
        const latest = await syncAuthUser();
        if (latest?.avatar) updateUser({ avatar: latest.avatar });
      } catch { /* progress was already proven by the status endpoint */ }
      router.replace(status.step === "first_post" ? "/feed/create" : "/feed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your photo. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#06070d] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[75dvh] w-full max-w-lg flex-col justify-center gap-6">
        <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.2em]">
          <span className="text-[#FF5BFC]">DVNT · Welcome</span>
          <span className="text-white/55">Step 1 of 2</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#3FDCFF] to-[#FF5BFC]" />
        </div>
        <div className="space-y-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#FF5BFC]/30 bg-[#FF5BFC]/12">
            <Camera className="text-[#FF5BFC]" size={27} aria-hidden="true"/>
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight">First, show us who's here.</h1>
          <p className="text-base leading-7 text-white/70">
            Every new DVNT member starts with a profile picture. Upload a real photo of yourself before you create your first post and enter the community.
          </p>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()}
          aria-label="Choose a profile photo"
          className="flex min-h-56 flex-col items-center justify-center gap-3 overflow-hidden rounded-[28px] border-2 border-dashed border-[#3FDCFF]/40 bg-white/5 text-white hover:bg-white/9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FDCFF]">
          {preview
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="Selected profile photo preview" className="h-64 w-full object-contain"/>
            : <><ImagePlus size={36} className="text-[#3FDCFF]"/><span className="font-bold">Choose a photo or use your camera</span><span className="text-sm text-white/55">JPEG, PNG and supported images</span></>}
        </button>
        <input ref={inputRef} hidden type="file" accept="image/*" onChange={onFile} />
        {error && <p role="alert" className="rounded-xl border border-rose-400/35 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p>}
        <button type="button" onClick={() => void savePhoto()} disabled={!preview || submitting}
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3FDCFF] to-[#FF5BFC] px-5 font-extrabold text-[#07040C] disabled:opacity-45">
          {submitting ? <><LoaderCircle size={19} className="animate-spin"/> Saving and verifying photo…</> :
            <><CheckCircle2 size={19}/> Save photo &amp; create first post</>}
        </button>
        <p className="text-center text-xs text-white/45">
          Your progress is saved to your DVNT account. If you leave and return, you'll resume where you stopped.
        </p>
      </div>
    </main>
  );
}
