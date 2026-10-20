# Browser Live Photo intake diagnostic (playback-v3)

This standalone, local-only investigation page is mirrored byte-for-byte at `/diagnostics/browser-live-photo-intake.html`. It is a diagnostic, not a Live Photo upload fix or workaround. No mobile release, handoff enablement, backend or schema changes are included.

Select the same original Photos item in Safari and Chrome using each of the four input variants (explicit formats, images, unrestricted, video only). If that original is unavailable in a picker, record that with the unavailable button rather than selecting a different asset. Browser/version display is a user-agent hint, not engine verification.

## Coverage and interpretation

The page reads the entire browser-supplied file up to 32 MiB, scans for bounded BMFF candidate offsets, walks JPEG segments and entropy-coded marker boundaries through EOI, and inspects trailing data. It checks basic SOF/SOS component layouts, but does not decode the JPEG. XMP, extended XMP, MPF and JUMBF presence is reported without raw values. These metadata formats are not semantically decoded or reassembled, and their references are not resolved. Unknown APP payloads are opaque.

BMFF boxes use bounded 32/64-bit lengths, recursive known container walking and exact `moov/trak/mdia/hdlr` ancestry for `vide` handlers. Unknown boxes and media payloads remain opaque. Valid movie box structure and a video handler are evidence for further investigation, not decoded motion or a verified Live Photo pair. Overlapping candidate scans are deduplicated by movie/handler offsets. A valid still container cannot establish absence of embedded motion. Unsupported or malformed structures are reported as incomplete, never as proof of no motion.

Limits: 32 MiB per file, 4 files per selection, 8 retained reports, 4096 structural entries across candidate checks, 16 nesting levels, first 64 ftyp candidate offsets and 3 seconds of synchronous parsing per file (checked periodically). Limits can make inspection incomplete. File reading is asynchronous and abortable; parsing is synchronous but bounded. Clear, picker cancellation and newer selections invalidate stale reads. No whole-file text conversion, image conversion, upload, automatic saving, private metadata text disclosure or filename disclosure occurs. CSP blocks network and images, allowing only local blob media; no external dependencies or analytics are present.

Run `node scripts/test-browser-intake-diagnostic.cjs`. Fixtures are synthetic only. Passing tests do not substitute for a physical phone picker test. No real-user files are committed.

## Optional local playback

After inspection, each eligible complete ISO BMFF movie candidate with a video handler gets a “Play file N locally” button. No blob URL or playback is created until that explicit tap. The selected browser-supplied file is attached directly to a local video element, never uploaded. JPEG trailers are not extracted by this test. Oversize, incomplete or non-movie candidates do not get a preview.

The report records finite duration, dimensions, browser media error code (never error text), and whether playback time advanced outside a seek. These are decoding/timing evidence, not proof that pixels moved or that the movie matches the original Photos asset. The phone user must compare the displayed motion with the original Live Photo. Media controls permit retry if the browser blocks play. Clear, replacement, picker cancellation and pagehide invalidate callbacks, stop video and revoke the one active object URL. Multiple candidates have separate buttons, but only one preview is active.

The Node test uses a mock video element for lifecycle/security assertions; it does not prove codec support. Actual browser decoding and phone asset identity require separate verification.

CI runs `node scripts/test-browser-intake-playback-browser.cjs` in the existing real Chrome job with ffmpeg-generated H.264 MP4. It checks decoding, metadata, explicit tap, timing, pause, replacement, Clear, pagehide and absence of external requests. This is synthetic media, not a phone Photos picker test.
