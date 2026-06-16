import ExpoModulesCore
import NaturalLanguage

// Apple Translation framework.
// Xcode 26 SDK removed TranslationSession.Configuration, TranslationRequest,
// and translate(requests:). The only session init is now:
//   TranslationSession(installedSource:target:)  — requires iOS 26.0+
// LanguageAvailability.status(from:to:) remains available from iOS 18.0+.
// Weak-linked via podspec so the binary loads on all supported OS versions.
#if canImport(Translation)
import Translation
#endif

// MARK: - Module

public class DVNTTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DVNTTranslation")

    // ── isTranslationAvailable ─────────────────────────────────────────────
    // Uses LanguageAvailability (iOS 18+) when available; always false below.
    AsyncFunction("isTranslationAvailable") {
      (sourceLanguage: String, targetLanguage: String) async -> Bool in
      guard #available(iOS 18.0, *) else { return false }
      #if canImport(Translation)
      return await DVNTTranslationModule.checkAvailable(
        source: sourceLanguage, target: targetLanguage)
      #else
      return false
      #endif
    }

    // ── getAvailabilityStatus ──────────────────────────────────────────────
    AsyncFunction("getAvailabilityStatus") {
      (sourceLanguage: String, targetLanguage: String) async -> String in
      guard #available(iOS 18.0, *) else { return "unsupported" }
      #if canImport(Translation)
      return await DVNTTranslationModule.availabilityStatus(
        source: sourceLanguage, target: targetLanguage)
      #else
      return "unsupported"
      #endif
    }

    // ── detectLanguage ─────────────────────────────────────────────────────
    // NLLanguageRecognizer — no OS gate required.
    AsyncFunction("detectLanguage") {
      (text: String) async -> String in
      return DVNTTranslationModule.detectCode(text)
    }

    // ── translateText ──────────────────────────────────────────────────────
    // TranslationSession(installedSource:target:) is iOS 26.0+.
    // Below iOS 26 we throw so the JS layer can fall back to web translation.
    AsyncFunction("translateText") {
      (text: String, sourceLanguage: String, targetLanguage: String) async throws -> [String: Any] in
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return ["translatedText": text, "detectedSourceLanguage": ""]
      }
      guard #available(iOS 26.0, *) else {
        throw DVNTTranslationError.unavailable
      }
      #if canImport(Translation)
      let tgtCode = DVNTTranslationModule.normalizeCode(targetLanguage)
      let srcCode: String?
      if sourceLanguage == "auto" || sourceLanguage.isEmpty {
        let detected = DVNTTranslationModule.detectCode(text)
        srcCode = detected == "und" ? nil : detected
      } else {
        srcCode = DVNTTranslationModule.normalizeCode(sourceLanguage)
      }
      if let src = srcCode, src == tgtCode {
        return ["translatedText": text, "detectedSourceLanguage": src]
      }
      let srcLang: Locale.Language? = srcCode.map { Locale.Language(identifier: $0) }
      let tgtLang = Locale.Language(identifier: tgtCode)
      let translated = try await DVNTTranslationModule.translate(
        text: text, source: srcLang, target: tgtLang)
      return ["translatedText": translated, "detectedSourceLanguage": srcCode ?? ""]
      #else
      throw DVNTTranslationError.unavailable
      #endif
    }

    // ── translateBatch ─────────────────────────────────────────────────────
    AsyncFunction("translateBatch") {
      (items: [String], sourceLanguage: String, targetLanguage: String) async throws -> [[String: Any]] in
      guard #available(iOS 26.0, *) else {
        throw DVNTTranslationError.unavailable
      }
      #if canImport(Translation)
      guard !items.isEmpty else { return [] }
      let tgtCode = DVNTTranslationModule.normalizeCode(targetLanguage)
      let srcCode: String? = (sourceLanguage == "auto" || sourceLanguage.isEmpty)
        ? nil
        : DVNTTranslationModule.normalizeCode(sourceLanguage)
      let srcLang: Locale.Language? = srcCode.map { Locale.Language(identifier: $0) }
      let tgtLang = Locale.Language(identifier: tgtCode)

      var results: [[String: Any]] = []
      for item in items {
        if item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          results.append(["originalText": item, "translatedText": item, "success": true])
          continue
        }
        do {
          let translated = try await DVNTTranslationModule.translate(
            text: item, source: srcLang, target: tgtLang)
          results.append(["originalText": item, "translatedText": translated, "success": true])
        } catch {
          results.append([
            "originalText": item, "translatedText": item,
            "success": false, "error": error.localizedDescription,
          ])
        }
      }
      return results
      #else
      throw DVNTTranslationError.unavailable
      #endif
    }

    // ── downloadLanguagePack ───────────────────────────────────────────────
    // Stub for JS API symmetry. LanguageAvailability.downloadLanguage(_:)
    // was removed from the Xcode 26 SDK; the system manages packs automatically.
    AsyncFunction("downloadLanguagePack") { (_: String) async -> Void in }

    // ── getAvailableLanguages ──────────────────────────────────────────────
    AsyncFunction("getAvailableLanguages") {
      () async -> [String] in
      guard #available(iOS 26.0, *) else { return [] }
      return [
        "en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "ar", "ru",
        "th", "vi", "pl", "nl", "tr", "id", "uk", "hi", "sv", "da", "fi",
        "nb", "cs", "hu", "ro", "sk", "bg", "hr", "ms",
      ]
    }
  }

  // MARK: - Helpers

  static func normalizeCode(_ code: String) -> String {
    return code.split(separator: "-").first.map(String.init) ?? code
  }

  static func detectCode(_ text: String) -> String {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(String(text.prefix(500)))
    guard let lang = recognizer.dominantLanguage, lang != .undetermined else {
      return "und"
    }
    return lang.rawValue
  }

  // MARK: - Translation core

  #if canImport(Translation)

  // Single-string translation using the iOS 26+ API.
  // For .supported (pack not yet installed) we throw notInstalled so the
  // JS layer can route to a web fallback; there is no programmatic download
  // trigger in the current SDK.
  @available(iOS 26.0, *)
  static func translate(
    text: String,
    source: Locale.Language?,
    target: Locale.Language
  ) async throws -> String {
    let resolvedSrc: Locale.Language
    if let src = source {
      resolvedSrc = src
    } else {
      let detected = detectCode(text)
      guard detected != "und" else { throw DVNTTranslationError.detectionFailed }
      resolvedSrc = Locale.Language(identifier: detected)
    }

    if resolvedSrc.languageCode == target.languageCode { return text }

    let avail = LanguageAvailability()
    let status = await avail.status(from: resolvedSrc, to: target)

    switch status {
    case .installed:
      let session = TranslationSession(installedSource: resolvedSrc, target: target)
      let response = try await session.translate(text)
      return response.targetText
    default:
      throw DVNTTranslationError.notInstalled
    }
  }

  // LanguageAvailability.status(from:to:) is iOS 18.0+ and unchanged in Xcode 26.
  @available(iOS 18.0, *)
  static func checkAvailable(source: String, target: String) async -> Bool {
    let avail = LanguageAvailability()
    let tgt = Locale.Language(identifier: normalizeCode(target))

    if source != "auto" && !source.isEmpty {
      let src = Locale.Language(identifier: normalizeCode(source))
      let status = await avail.status(from: src, to: tgt)
      return status != .unsupported
    }

    for code in ["en", "es", "fr", "de", "zh", "ja", "ko", "ar", "ru", "pt", "it"] {
      let src = Locale.Language(identifier: code)
      let status = await avail.status(from: src, to: tgt)
      if status != .unsupported { return true }
    }
    return false
  }

  @available(iOS 18.0, *)
  static func availabilityStatus(source: String, target: String) async -> String {
    let avail = LanguageAvailability()
    let src = Locale.Language(identifier: normalizeCode(source))
    let tgt = Locale.Language(identifier: normalizeCode(target))
    let status = await avail.status(from: src, to: tgt)
    switch status {
    case .installed: return "installed"
    case .supported: return "supported"
    case .unsupported: return "unsupported"
    @unknown default: return "unknown"
    }
  }

  #endif
}

// MARK: - Errors

enum DVNTTranslationError: LocalizedError {
  case unavailable
  case notInstalled
  case detectionFailed

  var errorDescription: String? {
    switch self {
    case .unavailable:
      return "Translation requires iOS 26.0+ with the current SDK"
    case .notInstalled:
      return "Language pack not installed — use system settings or web translation fallback"
    case .detectionFailed:
      return "Could not detect source language"
    }
  }
}
