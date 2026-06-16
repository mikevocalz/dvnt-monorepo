import { requireOptionalNativeModule } from 'expo-modules-core';

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage: string;
}

export interface BatchTranslationItem {
  originalText: string;
  translatedText: string;
  success: boolean;
  error?: string;
}

interface DVNTTranslationModuleType {
  // Capability
  isTranslationAvailable(sourceLanguage: string, targetLanguage: string): Promise<boolean>;
  getAvailabilityStatus(sourceLanguage: string, targetLanguage: string): Promise<'installed' | 'supported' | 'unsupported' | 'unknown'>;
  getAvailableLanguages(): Promise<string[]>;
  downloadLanguagePack(language: string): Promise<void>;

  // Detection
  detectLanguage(text: string): Promise<string>;

  // Translation
  translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationResult>;
  translateBatch(items: string[], sourceLanguage: string, targetLanguage: string): Promise<BatchTranslationItem[]>;
}

// requireOptionalNativeModule returns null when the native module is not registered,
// preventing a JS bundle load failure on platforms or builds without the native code.
const DVNTTranslationModule = requireOptionalNativeModule<DVNTTranslationModuleType>('DVNTTranslation');
export default DVNTTranslationModule;
