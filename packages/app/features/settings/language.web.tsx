"use client";

import { useRouter } from "solito/navigation";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  supportedLanguages,
  changeLanguage,
  getCurrentLanguage,
} from "@dvnt/app/lib/i18n";

/**
 * Language settings — web (port of native `app/settings/language.tsx`). Law 1:
 * faithful to the native data flow — the option list and selected value + setter
 * come from the EXACT same i18n module (`supportedLanguages`, `changeLanguage`,
 * `getCurrentLanguage`), and the selected value is `i18n.language` straight off
 * `useTranslation` (no local useState; selection lives in the i18n store).
 * Selecting a language calls `changeLanguage` then toasts, identical to native.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off), sticky
 * header + close X like legal-page.web.tsx, rounded card rows with a cyan Check
 * on the selected option.
 */
export function LanguageScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const selectedLanguage = i18n.language || getCurrentLanguage();

  const handleSelectLanguage = (code: string) => {
    const success = changeLanguage(code);
    if (success) {
      toast.success(t("settings.language"), {
        description: t("common.save"),
      });
    } else {
      toast.error(t("common.error"));
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">{t("settings.language")}</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <p className="mb-3 text-sm text-white/60">{t("settings.systemDefault")}</p>

        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          {supportedLanguages.map((language) => {
            const selected = selectedLanguage === language.code;
            return (
              <button
                key={language.code}
                type="button"
                onClick={() => handleSelectLanguage(language.code)}
                className="w-full flex items-center justify-between py-3.5 border-b border-white/8 last:border-0 text-left active:bg-white/5"
              >
                <span className="flex flex-col">
                  <span className="font-semibold text-white">{language.name}</span>
                  <span className="text-sm text-white/60">{language.native}</span>
                </span>
                {selected ? <Check size={20} color="#3FDCFF" /> : null}
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
