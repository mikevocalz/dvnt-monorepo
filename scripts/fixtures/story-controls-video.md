# Offline story video fixture

`story-controls-video.webm` is a synthetic 16×16 purple VP9 video with a real
60-second duration, no audio, and no user media. The browser regression holds
its response to test cold video readiness, then decodes it with the actual
production player. Geometry tests stub `play()` only; metadata remains real.

Reproduce with FFmpeg:

```sh
ffmpeg -f lavfi -i color=c=0x8A40CF:s=16x16:r=1 -t 60 -an \
  -c:v libvpx-vp9 -b:v 4k story-controls-video.webm
```
