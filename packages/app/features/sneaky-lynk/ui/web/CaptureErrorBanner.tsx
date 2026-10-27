/** Capture permissions affect sending, not membership or receiving audio. */
export function CaptureErrorBanner({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div role="alert" className="mx-3 mb-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
      <p className="font-semibold">Camera or microphone unavailable</p>
      <p className="mt-1">{error}</p>
      <p className="mt-1">You can stay in the room and listen. Allow camera or microphone access in your browser&apos;s site settings, then retry.</p>
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry camera and microphone"
        className="mt-2 min-h-11 rounded-lg bg-white/10 px-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
      >
        Retry
      </button>
    </div>
  );
}
