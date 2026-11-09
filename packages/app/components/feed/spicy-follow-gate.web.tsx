"use client";
import { useSpicyFollowGate } from "./use-spicy-follow-gate";
export function SpicyFollowGate({
  author,
  height = 240,
}: {
  author?: { id?: string; username?: string };
  height?: number;
}) {
  const gate = useSpicyFollowGate(author);
  return (
    <section
      aria-label="Protected Spicy post"
      className="relative isolate flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-[#171025] p-4 text-center text-white"
      style={{ minHeight: height }}
    >
      {/* Decorative blur only. Original media and text are never mounted or fetched. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at 25% 30%, #58336d, transparent 65%), radial-gradient(ellipse at 75% 80%, #26566b, transparent 60%)",
        }}
      />
      <strong>Request to FOLLOW</strong>
      <p className="text-xs text-white/70">{gate.note}</p>
      <button
        type="button"
        disabled={gate.disabled}
        onClick={gate.act}
        className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
      >
        {gate.label}
      </button>
      {gate.statusError && (
        <button type="button" onClick={gate.retry}>
          Retry
        </button>
      )}
      {gate.failed && (
        <p role="alert" className="text-xs">
          Could not update follow. Please try again.
        </p>
      )}
    </section>
  );
}
