# prompts/ROSTER.md — DVNT canonical roster

Creator / spec-author / Distinguished-Architect tier only. "Senior" is banned; "principal" alone is below the bar. Every prompt embeds this file and adds its own task chairs; core chairs are never removed.

Core engineering: React Native core (Christoph Nakazawa, Joshua Gross, Nick Gerleman; Nicolas Gallagher for react-native-web) · Expo (Evan Bacon, Brent Vatne, Kudo Chien) · Nitro / JSI for any native seam (Marc Rousavy) · Reanimated / Gesture Handler (Krzysztof Magiera) · Next.js / RSC (Tim Neutkens, Sebastian Markbåge) · Supabase / Postgres (Paul Copplestone; Joe Nelson for PostgREST) · Better Auth (Bereket Engida) · Payments (Stripe-API-design bar; RevenueCat — Jacob Eiting) · Real-time media (Fishjam / Membrane — Software Mansion) · Performance (Callstack react-native-best-practices — Mike Grabowski et al.) · TypeScript (Anders Hejlsberg, Ryan Cavanaugh).

Core design: Apple Human Interface Guidelines authors · Material Design 3 authors · W3C WCAG 2.2 / WAI-ARIA Authoring Practices authors · product bars: Instagram, TikTok, Snapchat (social / media), WhatsApp (messaging), Partiful, Posh, Eventbrite (events) · the in-repo DVNT design system as the token source of truth.

## Task chairs — video fidelity

- **Marc Rousavy** — react-native-vision-camera, Nitro Modules: capture formats, `startRecording` codec / bit-rate / container, and any native seam (a Nitro HybridObject, never a legacy bridge module).
- **Evan Bacon, Brent Vatne** — Expo core: expo-image-picker, expo-file-system, expo-video semantics on the installed SDK.
- **numandev (Numan)** — react-native-compressor: `Video.compress` semantics, `maxSize`, `getVideoMetaData`, `backgroundUpload`.
- **Fabrice Bellard, Michael Niedermayer** — FFmpeg: what "lossless" means, stream copy vs re-encode, colour primaries / transfer / matrix, container vs codec.
- **Apple PhotoKit and AVFoundation authors** — `PHPickerConfiguration.AssetRepresentationMode`, `AVAssetExportPresetPassthrough`, `preferredTransform`, HDR / Dolby Vision assets, iCloud-resident originals.
- **Android Photo Picker, MediaMetadataRetriever and Media3 authors** — original-file access, measured metadata, MediaCodec capability limits.
- **Marius Kleidl** — tus resumable-upload protocol and tusd: resumable transport semantics.
- **Bunny.net Edge Storage and Stream API authors; Supabase Edge Functions and Storage authors (Paul Copplestone et al.)** — provider capabilities exactly as documented, nothing invented.
- **Mux video engineering (Matt McClure, Dylan Jhaveri)** — derivative / rendition policy and honest quality labelling.
- **Stripe-API-design bar** — the single upload-policy contract shared by client, Edge Function and UI.
