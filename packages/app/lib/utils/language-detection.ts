/**
 * Language detection utility for translation feature
 * Detects if text is in a different language than the user's selected language
 */

import { supportedLanguages } from "@dvnt/app/lib/i18n";

/**
 * Detect if text is likely in a specific non-English language.
 * Uses ONLY distinctive diacritics and character sets — NOT word lists,
 * which cause too many false positives with common short English words.
 * Returns the detected language code or null if it looks like English/undetermined.
 */
export function detectLanguage(text: string): string | null {
  if (!text || text.trim().length < 3) return null;

  // Non-Latin scripts — unambiguous
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja"; // Hiragana/Katakana
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return "zh"; // CJK
  if (/[\u0400-\u04FF]/.test(text)) return "ru"; // Cyrillic
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) return "ar"; // Arabic
  if (/[\u0900-\u097F]/.test(text)) return "hi"; // Devanagari
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return "ko"; // Korean
  if (/[\u0E00-\u0E7F]/.test(text)) return "th"; // Thai

  // Latin-script distinctive diacritics only.
  // These characters are extremely rare in genuine English text.
  if (/[ñ¿¡]/.test(text)) return "es"; // Spanish-exclusive
  if (/ß/.test(text)) return "de"; // German-exclusive
  if (/[çœâêîûù]/.test(text)) return "fr"; // French-distinctive
  if (/[äöÄÖ]/.test(text)) return "de"; // German umlauts
  if (/[áéíóúÁÉÍÓÚ]/.test(text)) return "es"; // Spanish/Portuguese accented vowels
  if (/[àèìòùÀÈÌÒÙ]/.test(text)) return "it"; // Italian grave accents

  // No distinctive non-English markers — assume English/undetermined
  return null;
}

/**
 * Check if text should be translatable based on user's language preference.
 * Returns true ONLY when the text is definitively in a different language.
 * Never shows the button for content that is already in the user's language.
 */
export function shouldShowTranslateButton(
  text: string,
  userLanguage: string,
): boolean {
  if (!text || text.trim().length < 10) return false;

  const userLang = (userLanguage || "en").split("-")[0].toLowerCase();

  // Detect using character sets and distinctive diacritics only
  const detectedLang = detectLanguage(text);

  // No distinctive non-English markers found → text is most likely in the
  // user's language already. Never show the button.
  if (!detectedLang) return false;

  // Text is definitively in a specific language — show button only when
  // that language differs from the user's configured language.
  return detectedLang !== userLang;
}

/**
 * Get display name for a language code
 */
export function getLanguageDisplayName(langCode: string): string {
  const names: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    ja: "Japanese",
    zh: "Chinese",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ko: "Korean",
    ar: "Arabic",
  };
  return names[langCode] || langCode.toUpperCase();
}
