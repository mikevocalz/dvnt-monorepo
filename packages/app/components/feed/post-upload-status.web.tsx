"use client";
import { useSyncExternalStore } from "react";
import { postPublishQueue } from "@dvnt/app/lib/posts/publish-queue";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function PostUploadStatus() {
  const jobs = useSyncExternalStore(postPublishQueue.subscribe, postPublishQueue.getSnapshot, postPublishQueue.getSnapshot);
  const owner = useAuthStore((state) => state.user);
  return <div aria-live="polite">{jobs.filter((job) => job.ownerId === String(owner?.id) || job.ownerId === owner?.authId).map((job) => (
    <div key={job.id} className="mx-3 my-2 flex items-center gap-3 rounded-xl bg-[#161c29] p-3 text-white">
      {job.status !== "failed" && <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400 motion-reduce:animate-none" />}
      {/* Web never resumes: an object URL dies with the tab, so job.resumed is always false here. */}
      <div className="min-w-0 flex-1"><p className="font-semibold">{job.status === "failed" ? "Post not shared" : job.resumed ? "Interrupted post, picked back up" : job.label}</p><p className="text-sm text-white/65">{job.message}</p></div>
      {job.status === "failed" && <><button className="min-h-11 px-2 text-cyan-400" onClick={() => postPublishQueue.retry(job.id)}>Retry</button><button className="min-h-11 px-2 text-white/65" onClick={() => postPublishQueue.dismiss(job.id)}>Dismiss</button></>}
    </div>
  ))}</div>;
}
