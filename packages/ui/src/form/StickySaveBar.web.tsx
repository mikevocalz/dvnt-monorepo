"use client";

export interface StickySaveBarProps {
  /** Show the bar (typically === isDirty). When false, nothing renders. */
  visible: boolean;
  /** Save handler. */
  onSave: () => void;
  /** Discard/cancel handler — reverts the form. */
  onCancel?: () => void;
  /** Disables Save (e.g. invalid form). */
  disabled?: boolean;
  /** In-flight state — shows a spinner label and blocks double-submit. */
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
}

/**
 * Sticky save bar (web) — pinned above the tab bar, revealed when the form is
 * dirty (Law 3: "sticky save bar"). Pairs with `useDirtyGuard`. Sits above the
 * web tab bar (z-1000) and respects the safe-area inset.
 */
export function StickySaveBar({
  visible,
  onSave,
  onCancel,
  disabled,
  saving,
  saveLabel = "Save changes",
  cancelLabel = "Discard",
}: StickySaveBarProps) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-x-0 z-[1100] flex items-center justify-end gap-3 px-4 py-3 border-t border-white/10"
      style={{
        bottom: 0,
        paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
        background: "rgba(8,10,18,0.72)",
        backdropFilter: "saturate(160%) blur(18px)",
        WebkitBackdropFilter: "saturate(160%) blur(18px)",
      }}
      role="region"
      aria-label="Unsaved changes"
    >
      <span className="mr-auto text-sm text-white/50">Unsaved changes</span>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 h-10 rounded-xl text-sm font-semibold text-white/80 bg-white/8 active:scale-95 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving}
        className="px-5 h-10 rounded-xl text-sm font-bold text-white bg-linear-to-r from-cyan-500 to-violet-600 active:scale-95 disabled:opacity-50"
      >
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
