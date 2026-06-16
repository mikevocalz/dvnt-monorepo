/**
 * Free Weather Sound Registry
 *
 * Maps WeatherEffect → audio asset path + attribution metadata.
 * All assets live under assets/audio/weather/ and must be truly
 * free / redistributable (CC0 or Pixabay license).
 *
 * IMPORTANT: Do NOT hardcode external URLs at runtime.
 * Store source URLs only as attribution metadata.
 */
import { WeatherEffect } from "../weatherfx/weatherTypes";

export interface SoundAsset {
  /** require() path — Metro resolves at bundle time */
  source: number;
  /** Human-readable name */
  name: string;
  loop: boolean;
  /** Base volume (0–1) before intensity scaling */
  baseVolume: number;
}

export interface SoundAttribution {
  assetName: string;
  author: string;
  license: string;
  sourceUrl: string;
  modifications: string;
}

// ── Static asset map ────────────────────────────────────────────────
// Uncomment each entry as the corresponding .mp3 is added to
// assets/audio/weather/. Missing files won't crash — the audio
// engine skips effects without a registered asset.
//
// Metro requires STATIC require() paths, so every entry must be
// a literal string — no dynamic path building.

export function getWeatherSoundAsset(
  effect: WeatherEffect,
): SoundAsset | null {
  switch (effect) {
    // case WeatherEffect.Rain:
    //   return {
    //     source: require("@/assets/audio/weather/rain_light_loop.mp3"),
    //     name: "rain_light_loop",
    //     loop: true,
    //     baseVolume: 0.5,
    //   };
    // case WeatherEffect.HeavyRain:
    //   return {
    //     source: require("@/assets/audio/weather/rain_heavy_loop.mp3"),
    //     name: "rain_heavy_loop",
    //     loop: true,
    //     baseVolume: 0.6,
    //   };
    // case WeatherEffect.Snow:
    //   return {
    //     source: require("@/assets/audio/weather/snow_ambient_loop.mp3"),
    //     name: "snow_ambient_loop",
    //     loop: true,
    //     baseVolume: 0.35,
    //   };
    // case WeatherEffect.Thunder:
    //   return {
    //     source: require("@/assets/audio/weather/thunder_distant_loop.mp3"),
    //     name: "thunder_distant_loop",
    //     loop: true,
    //     baseVolume: 0.55,
    //   };
    // case WeatherEffect.Fog:
    //   return {
    //     source: require("@/assets/audio/weather/wind_loop.mp3"),
    //     name: "wind_loop",
    //     loop: true,
    //     baseVolume: 0.3,
    //   };
    default:
      return null;
  }
}

// ── Attribution database ────────────────────────────────────────────
// Every asset MUST have an entry here before shipping.
export const SOUND_ATTRIBUTIONS: SoundAttribution[] = [
  {
    assetName: "rain_light_loop.mp3",
    author: "Pixabay",
    license: "Pixabay Content License (free for commercial use)",
    sourceUrl: "https://pixabay.com/sound-effects/search/rain/",
    modifications: "Trimmed to seamless loop, normalised volume",
  },
  {
    assetName: "rain_heavy_loop.mp3",
    author: "Pixabay",
    license: "Pixabay Content License (free for commercial use)",
    sourceUrl: "https://pixabay.com/sound-effects/search/heavy+rain/",
    modifications: "Trimmed to seamless loop, normalised volume",
  },
  {
    assetName: "wind_loop.mp3",
    author: "Pixabay",
    license: "Pixabay Content License (free for commercial use)",
    sourceUrl: "https://pixabay.com/sound-effects/search/wind/",
    modifications: "Trimmed to seamless loop, low-pass filtered for ambience",
  },
  {
    assetName: "thunder_distant_loop.mp3",
    author: "Pixabay",
    license: "Pixabay Content License (free for commercial use)",
    sourceUrl: "https://pixabay.com/sound-effects/search/thunder/",
    modifications: "Trimmed to seamless loop, layered with rain bed",
  },
  {
    assetName: "snow_ambient_loop.mp3",
    author: "Pixabay",
    license: "Pixabay Content License (free for commercial use)",
    sourceUrl: "https://pixabay.com/sound-effects/search/snow+ambient/",
    modifications: "Trimmed to seamless loop, soft wind + chime ambience",
  },
];
