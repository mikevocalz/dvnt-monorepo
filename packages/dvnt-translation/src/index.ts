import DVNTTranslationModule from './TranslationModule';
export type { TranslationResult, BatchTranslationItem } from './TranslationModule';

export async function isTranslationAvailable(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<boolean> {
  if (!DVNTTranslationModule) return false;
  try {
    return await DVNTTranslationModule.isTranslationAvailable(sourceLanguage, targetLanguage);
  } catch {
    return false;
  }
}

export async function getAvailabilityStatus(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<'installed' | 'supported' | 'unsupported' | 'unknown'> {
  if (!DVNTTranslationModule) return 'unsupported';
  try {
    return await DVNTTranslationModule.getAvailabilityStatus(sourceLanguage, targetLanguage);
  } catch {
    return 'unsupported';
  }
}

export async function detectLanguage(text: string): Promise<string> {
  if (!DVNTTranslationModule) return 'und';
  try {
    return await DVNTTranslationModule.detectLanguage(text);
  } catch {
    return 'und';
  }
}

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<{ translatedText: string; detectedSourceLanguage: string }> {
  if (!DVNTTranslationModule) {
    throw new Error('DVNTTranslation native module is not available');
  }
  return await DVNTTranslationModule.translateText(text, sourceLanguage, targetLanguage);
}

export async function translateBatch(
  items: string[],
  sourceLanguage: string,
  targetLanguage: string,
): Promise<{ originalText: string; translatedText: string; success: boolean; error?: string }[]> {
  if (!DVNTTranslationModule) {
    throw new Error('DVNTTranslation native module is not available');
  }
  return await DVNTTranslationModule.translateBatch(items, sourceLanguage, targetLanguage);
}

export async function downloadLanguagePack(language: string): Promise<void> {
  if (!DVNTTranslationModule) return;
  return DVNTTranslationModule.downloadLanguagePack(language);
}

export async function getAvailableLanguages(): Promise<string[]> {
  if (!DVNTTranslationModule) return [];
  try {
    return await DVNTTranslationModule.getAvailableLanguages();
  } catch {
    return [];
  }
}
