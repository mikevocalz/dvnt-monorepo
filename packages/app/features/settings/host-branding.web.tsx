"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { ImageIcon, Printer, Type, AlertCircle, Upload, X } from "lucide-react";
import { FormField, StickySaveBar, useDirtyGuard } from "@dvnt/ui";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { brandingApi } from "@dvnt/app/lib/api/payments";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useHostBrandingUIStore } from "@dvnt/app/lib/stores/host-branding-ui-store";

const inputCls =
  "w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60";

/**
 * Host Receipt Branding — web (port of `app/settings/host-branding.tsx`).
 * Law 1: faithful to the native data flow — branding object lives in
 * `usePaymentsStore` (branding slice), loaded via `brandingApi.get` and persisted
 * via `brandingApi.update`; logo files upload through `useMediaUpload`. Law 3:
 * labeled `FormField`s, content column, `StickySaveBar` + `useDirtyGuard`,
 * file-input logo pickers with object-URL preview, rounded-SQUARE logo previews
 * (never circular).
 */
export function HostBrandingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const {
    branding,
    brandingLoading,
    setBranding,
    setBrandingLoading,
  } = usePaymentsStore();

  const { uploadSingle } = useMediaUpload({ folder: "branding", userId: user?.id });

  const {
    newLogoUri,
    newMonochromeUri,
    isSaving,
    setNewLogoUri,
    setNewMonochromeUri,
    setIsSaving,
    reset,
  } = useHostBrandingUIStore();

  const logoRef = useRef<HTMLInputElement>(null);
  const monoRef = useRef<HTMLInputElement>(null);

  // Load branding on mount — mirrors the native `loadBranding`.
  useEffect(() => {
    let active = true;
    (async () => {
      setBrandingLoading(true);
      try {
        const result = await brandingApi.get();
        if (!active) return;
        setBranding(
          result || {
            hostId: "",
            displayName: "",
            fallbackText: "",
            updatedAt: new Date().toISOString(),
          },
        );
      } catch (err) {
        console.error("[Branding] load error:", err);
      } finally {
        if (active) setBrandingLoading(false);
      }
    })();
    return () => {
      active = false;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty =
    !!branding && (!!newLogoUri || !!newMonochromeUri);
  useDirtyGuard(isDirty);

  const onPickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !branding) return;
    setNewLogoUri(URL.createObjectURL(file));
  };

  const onPickMonochrome = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !branding) return;
    setNewMonochromeUri(URL.createObjectURL(file));
  };

  const handleDisplayNameChange = (text: string) => {
    if (!branding) return;
    setBranding({ ...branding, displayName: text });
  };

  const handleFallbackTextChange = (text: string) => {
    if (!branding) return;
    setBranding({ ...branding, fallbackText: text });
  };

  const handleSave = async () => {
    if (!branding) return;
    setIsSaving(true);
    try {
      let logoUrl = branding.logoUrl;
      let logoMonochromeUrl = branding.logoMonochromeUrl;

      if (newLogoUri) {
        const res = await uploadSingle(newLogoUri);
        if (res.success && res.url) logoUrl = res.url;
        else showToast("warning", "Upload Issue", "Logo upload failed. Other changes will be saved.");
      }
      if (newMonochromeUri) {
        const res = await uploadSingle(newMonochromeUri);
        if (res.success && res.url) logoMonochromeUrl = res.url;
        else showToast("warning", "Upload Issue", "Monochrome logo upload failed. Other changes will be saved.");
      }

      const next = { ...branding, logoUrl, logoMonochromeUrl };
      setBranding(next);

      const result = await brandingApi.update(next);
      if (result.success) {
        setNewLogoUri(null);
        setNewMonochromeUri(null);
        showToast("success", "Saved", "Branding updated successfully");
      } else {
        showToast("error", "Error", result.error || "Failed to save");
      }
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const logoSrc = newLogoUri || branding?.logoUrl || "";
  const monoSrc = newMonochromeUri || branding?.logoMonochromeUrl || "";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Branding</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-xl px-4 pb-32 pt-4">
        {brandingLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-white/4 border border-white/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Color Logo */}
            <section className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon size={16} className="text-[#8A40CF]" />
                <h2 className="text-sm font-semibold text-white">Color Logo</h2>
              </div>
              <p className="text-xs text-white/40 mb-3">
                Displayed on PDF receipts, invoices, and tickets. Recommended: 3:1 aspect ratio, transparent PNG.
              </p>
              <button
                onClick={() => logoRef.current?.click()}
                className="w-full rounded-xl bg-white/5 border border-dashed border-white/10 p-4 flex flex-col items-center gap-2 active:scale-[0.99]"
              >
                {logoSrc ? (
                  <>
                    {/* rounded square preview — never circular */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoSrc} alt="Color logo" className="h-[60px] w-[180px] rounded-xl object-contain" />
                    <span className="text-xs text-white/40">Tap to replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-white/40" />
                    <span className="text-sm text-white/40">Upload Logo</span>
                  </>
                )}
              </button>
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={onPickLogo} />
            </section>

            {/* Monochrome Logo */}
            <section className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Printer size={16} className="text-[#6B7280]" />
                <h2 className="text-sm font-semibold text-white">Monochrome Logo</h2>
                <span className="rounded-lg bg-white/8 px-2 py-0.5 text-[10px] text-white/40">Optional</span>
              </div>
              <p className="text-xs text-white/40 mb-3">
                Used on thermal receipt printers. Must be black on white, no gradients, no color. Falls back to display
                name if not set.
              </p>
              <button
                onClick={() => monoRef.current?.click()}
                className="w-full rounded-xl bg-white border border-dashed border-white/10 p-4 flex flex-col items-center gap-2 active:scale-[0.99]"
              >
                {monoSrc ? (
                  <>
                    {/* rounded square preview — never circular */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={monoSrc} alt="Monochrome logo" className="h-[60px] w-[180px] rounded-xl object-contain" />
                    <span className="text-xs text-black/50">Tap to replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-black/40" />
                    <span className="text-sm text-black/50">Upload Monochrome Logo</span>
                  </>
                )}
              </button>
              <input ref={monoRef} type="file" accept="image/*" hidden onChange={onPickMonochrome} />
            </section>

            {/* Display Name */}
            <section className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Type size={16} className="text-[#3B82F6]" />
                <h2 className="text-sm font-semibold text-white">Display Name</h2>
              </div>
              <FormField
                htmlFor="hb-display-name"
                description="Shown on receipts when no logo is available. Used as fallback text on thermal printers."
              >
                <input
                  id="hb-display-name"
                  value={branding?.displayName || ""}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="e.g. DVNT Events"
                  className={inputCls}
                />
              </FormField>
            </section>

            {/* Receipt Footer Text */}
            <section className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Type size={16} className="text-[#22C55E]" />
                <h2 className="text-sm font-semibold text-white">Receipt Footer Text</h2>
              </div>
              <FormField htmlFor="hb-fallback-text">
                <input
                  id="hb-fallback-text"
                  value={branding?.fallbackText || ""}
                  onChange={(e) => handleFallbackTextChange(e.target.value)}
                  placeholder="e.g. Hosted by DVNT"
                  className={inputCls}
                />
              </FormField>
            </section>

            {/* Thermal Printer Guidelines */}
            <section className="rounded-2xl border border-orange-500/15 bg-orange-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className="text-[#F97316]" />
                <h2 className="text-sm font-semibold text-orange-400">Thermal Printer Guidelines</h2>
              </div>
              <p className="text-xs leading-5 text-white/40">
                • Monochrome logos must be black on white
                <br />• No gradients, transparency, or fine details
                <br />• QR codes sized ≥ 1.5cm with quiet zone
                <br />• 58mm width = 384px, 80mm width = 576px
                <br />• Safe margins: 12px all sides
              </p>
            </section>
          </div>
        )}
      </div>

      <StickySaveBar visible={isDirty} onSave={handleSave} onCancel={() => router.back()} saving={isSaving} />
    </div>
  );
}
