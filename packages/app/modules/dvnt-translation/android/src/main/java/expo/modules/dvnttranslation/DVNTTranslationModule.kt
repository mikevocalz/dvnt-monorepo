package expo.modules.dvnttranslation

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentifier
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class DVNTTranslationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DVNTTranslation")

    // ── translateText ──────────────────────────────────────────────────────
    AsyncFunction("translateText") { text: String, sourceLanguage: String, targetLanguage: String ->
      runBlocking {
        if (text.isBlank()) {
          return@runBlocking mapOf(
            "translatedText" to text,
            "detectedSourceLanguage" to "",
          )
        }

        val resolvedSource: String = if (sourceLanguage == "auto" || sourceLanguage.isEmpty()) {
          detectLanguageCode(text) ?: TranslateLanguage.ENGLISH
        } else {
          mapLanguageCode(sourceLanguage)
        }

        val targetLang = mapLanguageCode(targetLanguage)

        if (resolvedSource == targetLang) {
          return@runBlocking mapOf(
            "translatedText" to text,
            "detectedSourceLanguage" to resolvedSource,
          )
        }

        val options = TranslatorOptions.Builder()
          .setSourceLanguage(resolvedSource)
          .setTargetLanguage(targetLang)
          .build()

        val translator = Translation.getClient(options)
        try {
          val conditions = DownloadConditions.Builder().requireWifi().build()
          translator.downloadModelIfNeeded(conditions).await()
          val result = translator.translate(text).await()

          mapOf(
            "translatedText" to result,
            "detectedSourceLanguage" to resolvedSource,
          )
        } finally {
          translator.close()
        }
      }
    }

    // ── isTranslationAvailable ─────────────────────────────────────────────
    AsyncFunction("isTranslationAvailable") { sourceLanguage: String, targetLanguage: String ->
      val allLanguages = TranslateLanguage.getAllLanguages()

      if (sourceLanguage == "auto" || sourceLanguage.isEmpty()) {
        val commonSources = listOf("en", "es", "fr", "de", "zh", "ja", "ko", "ar", "ru", "pt", "it")
        val targetLang = mapLanguageCode(targetLanguage)
        allLanguages.contains(targetLang) &&
          commonSources.any { allLanguages.contains(mapLanguageCode(it)) }
      } else {
        val sourceLang = mapLanguageCode(sourceLanguage)
        val targetLang = mapLanguageCode(targetLanguage)
        allLanguages.contains(sourceLang) && allLanguages.contains(targetLang)
      }
    }

    // ── detectLanguage ─────────────────────────────────────────────────────
    AsyncFunction("detectLanguage") { text: String ->
      runBlocking { detectLanguageCode(text) } ?: "und"
    }

    // ── downloadLanguagePack ───────────────────────────────────────────────
    AsyncFunction("downloadLanguagePack") { language: String ->
      runBlocking {
        val langCode = mapLanguageCode(language)
        val model = TranslateRemoteModel.Builder(langCode).build()
        val conditions = DownloadConditions.Builder().build()
        RemoteModelManager.getInstance().download(model, conditions).await()
      }
    }

    // ── getAvailableLanguages ──────────────────────────────────────────────
    AsyncFunction("getAvailableLanguages") {
      TranslateLanguage.getAllLanguages().map { code ->
        when (code) {
          TranslateLanguage.CHINESE -> "zh"
          TranslateLanguage.ENGLISH -> "en"
          TranslateLanguage.SPANISH -> "es"
          TranslateLanguage.FRENCH -> "fr"
          TranslateLanguage.GERMAN -> "de"
          TranslateLanguage.ITALIAN -> "it"
          TranslateLanguage.PORTUGUESE -> "pt"
          TranslateLanguage.JAPANESE -> "ja"
          TranslateLanguage.KOREAN -> "ko"
          TranslateLanguage.ARABIC -> "ar"
          TranslateLanguage.RUSSIAN -> "ru"
          TranslateLanguage.THAI -> "th"
          TranslateLanguage.VIETNAMESE -> "vi"
          TranslateLanguage.POLISH -> "pl"
          TranslateLanguage.DUTCH -> "nl"
          TranslateLanguage.TURKISH -> "tr"
          TranslateLanguage.INDONESIAN -> "id"
          else -> code
        }
      }.distinct()
    }
  }

  private suspend fun detectLanguageCode(text: String): String? {
    val sample = text.take(500)
    val identifier = LanguageIdentification.getClient()
    return try {
      val tag = identifier.identifyLanguage(sample).await()
      identifier.close()
      if (tag == LanguageIdentifier.UNDETERMINED_LANGUAGE_TAG) null else tag
    } catch (e: Exception) {
      try { identifier.close() } catch (_: Exception) { }
      null
    }
  }

  private fun mapLanguageCode(code: String): String = when (code.split("-").first().lowercase()) {
    "zh" -> TranslateLanguage.CHINESE
    "en" -> TranslateLanguage.ENGLISH
    "es" -> TranslateLanguage.SPANISH
    "fr" -> TranslateLanguage.FRENCH
    "de" -> TranslateLanguage.GERMAN
    "it" -> TranslateLanguage.ITALIAN
    "pt" -> TranslateLanguage.PORTUGUESE
    "ja" -> TranslateLanguage.JAPANESE
    "ko" -> TranslateLanguage.KOREAN
    "ar" -> TranslateLanguage.ARABIC
    "ru" -> TranslateLanguage.RUSSIAN
    "th" -> TranslateLanguage.THAI
    "vi" -> TranslateLanguage.VIETNAMESE
    "pl" -> TranslateLanguage.POLISH
    "nl" -> TranslateLanguage.DUTCH
    "tr" -> TranslateLanguage.TURKISH
    "id" -> TranslateLanguage.INDONESIAN
    else -> code.split("-").first().lowercase()
  }
}

private suspend fun <T> com.google.android.gms.tasks.Task<T>.await(): T =
  suspendCancellableCoroutine { cont ->
    addOnSuccessListener { result ->
      @Suppress("UNCHECKED_CAST")
      cont.resume(result as T)
    }
    addOnFailureListener { ex ->
      cont.resumeWithException(ex)
    }
    addOnCanceledListener {
      cont.cancel()
    }
  }
