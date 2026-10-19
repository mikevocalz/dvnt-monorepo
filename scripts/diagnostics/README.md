# Browser Live Photo intake diagnostic

`browser-live-photo-intake.html` is a standalone investigation tool, not a DVNT app route or upload workaround. Open it in a browser or serve this directory with a local static server. An identical copy is included at `apps/web/public/diagnostics/browser-live-photo-intake.html` for this draft branch's preview only. Do not merge or deploy this investigation page to production. The preview must retain existing deployment protection; this change does not alter access settings. Use the same original Photos item for each of the three file-input `accept` variants.

The report records the actual files exposed to JavaScript, before page-side canvas/image manipulation. It cannot exclude Photos or browser conversion before JavaScript receives those files. It does not upload, persist, render, or extract the user's files. A restrictive Content Security Policy blocks network requests. File names and raw metadata values are not reported. Clear results to remove the report from the page; closing the page releases its in-memory data.

## Interpretation

- File count, declared MIME, and byte count establish what the browser handed the page, not what Photos holds internally.
- A valid top-level `moov` + `mdat` structure is a **movie container candidate**, not proof that a decoder can play it or that it belongs to another file.
- An Apple content-identifier marker in a still is **not** a companion video. This tool does not parse/expose the identifier value or claim a verified Apple pair.
- HEIC is also an ISO BMFF container. `ftyp` or `mdat` alone must not be called motion.
- No detected movie container is not proof that a file has no embedded payload: the diagnostic does not fully parse every container, Apple's MakerNote, or JPEG trailing data. In particular, it cannot recover a PhotoKit resource the browser never supplies.
- Files over 32 MiB are not read. No product-size-limit change is implied.

Run the synthetic safety/structure checks with `node scripts/test-browser-intake-diagnostic.cjs`. These tests do not substitute for a physical iPhone Safari/Photos selection or live playback. No user media is included in fixtures.
