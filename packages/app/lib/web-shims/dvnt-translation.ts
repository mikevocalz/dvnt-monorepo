/**
 * Web stub for the local Expo module @dvnt/app/modules/dvnt-translation (native
 * on-device translation). On web we no-op: translateText returns the input
 * unchanged. Real web translation is a follow-on.
 */
export function translateText(text: string): Promise<string> {
  return Promise.resolve(text);
}
export function isLanguageSupported(): boolean {
  return false;
}
export function prepareLanguage(): Promise<void> {
  return Promise.resolve();
}

// TranslationModule default export
export default {
  translateText,
  isLanguageSupported,
  prepareLanguage,
};
