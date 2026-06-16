# Weather Audio — Attribution & Licenses

All ambient weather sound assets used in DVNT must be documented here
before shipping. Every file under `assets/audio/weather/` requires a
corresponding entry.

## License Requirements

- **Pixabay Content License** — Free for commercial use, no attribution
  required but we keep it for transparency.
- **CC0 (Creative Commons Zero)** — Public domain, no restrictions.
- **CC BY 4.0** — Attribution required (include author + link).

> ⚠️ NEVER use CC BY-NC (non-commercial) or CC BY-SA (share-alike)
> assets — they are incompatible with a commercial app.

---

## Assets

### rain_light_loop.mp3

| Field         | Value                                              |
| ------------- | -------------------------------------------------- |
| Author        | Pixabay                                            |
| License       | Pixabay Content License (free for commercial use)  |
| Source        | https://pixabay.com/sound-effects/search/rain/     |
| Modifications | Trimmed to seamless loop, normalised volume        |

### rain_heavy_loop.mp3

| Field         | Value                                                    |
| ------------- | -------------------------------------------------------- |
| Author        | Pixabay                                                  |
| License       | Pixabay Content License (free for commercial use)        |
| Source        | https://pixabay.com/sound-effects/search/heavy+rain/     |
| Modifications | Trimmed to seamless loop, normalised volume              |

### wind_loop.mp3

| Field         | Value                                              |
| ------------- | -------------------------------------------------- |
| Author        | Pixabay                                            |
| License       | Pixabay Content License (free for commercial use)  |
| Source        | https://pixabay.com/sound-effects/search/wind/     |
| Modifications | Trimmed to seamless loop, low-pass filtered        |

### thunder_distant_loop.mp3

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Author        | Pixabay                                              |
| License       | Pixabay Content License (free for commercial use)    |
| Source        | https://pixabay.com/sound-effects/search/thunder/    |
| Modifications | Trimmed to seamless loop, layered with rain bed      |

### snow_ambient_loop.mp3

| Field         | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| Author        | Pixabay                                                    |
| License       | Pixabay Content License (free for commercial use)          |
| Source        | https://pixabay.com/sound-effects/search/snow+ambient/     |
| Modifications | Trimmed to seamless loop, soft wind + chime ambience       |

---

## Adding New Assets

1. Download from a license-safe source (Pixabay, FreeSound CC0, OpenGameArt CC0)
2. Verify the license allows commercial use without share-alike
3. Convert to MP3 (128kbps, mono, 44.1kHz) for small bundle size
4. Trim to a seamless loop (use Audacity crossfade)
5. Place in `assets/audio/weather/`
6. Add entry to this file AND to `freeSounds.ts` SOUND_ATTRIBUTIONS array
7. Uncomment the corresponding `getWeatherSoundAsset()` case
8. Test: loop plays smoothly, crossfade works, no pop/click at loop point

## Validation

Run from project root to check all audio files have attribution:

```bash
for f in assets/audio/weather/*.mp3; do
  name=$(basename "$f")
  if ! grep -q "$name" src/features/weatheraudio/licenses/ATTRIBUTION.md; then
    echo "MISSING ATTRIBUTION: $name"
  fi
done
```
