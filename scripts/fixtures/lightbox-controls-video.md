# Lightbox control layout fixture

Synthetic solid-purple 1080×1920 VP9 video, four seconds, no audio or personal
content. The portrait dimensions reproduce a fullscreen video reaching the
close toolbar on small mobile viewports.

Generated locally:

```sh
ffmpeg -f lavfi -i color=c=0x8A40CF:s=1080x1920:r=1 -t 4 -an \
  -c:v libvpx-vp9 -b:v 4k lightbox-controls-video.webm
```
