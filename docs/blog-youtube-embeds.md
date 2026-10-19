# YouTube videos in blog articles

In **Article content**, start a new line and type `/youtube`, then choose **YouTube video**. You can also choose it from the editor's block menu.

1. Paste a full YouTube watch, youtu.be share or Shorts URL.
2. Optionally add a descriptive video title for screen readers and a visible caption.
3. Use the block's Edit control to change those fields. The editor displays the same responsive player as the reader view.
4. Save Draft or Publish using the normal post workflow.

Existing `videoEmbed` content keeps its stored fields. Valid YouTube URLs in those blocks also render through the new player. Vimeo and direct-file video support are not added by this feature; non-YouTube content in a legacy block gets a safe unavailable notice rather than an arbitrary iframe. Other block converters are unchanged.

## Playback and security

The parser accepts only exact YouTube hosts and an 11-character video ID. The player URL is rebuilt on `www.youtube-nocookie.com`; input query strings (including autoplay, start-time, tracking and origin parameters) are not forwarded. The player is lazy-loaded, has an accessible title, supports fullscreen, and never autoplays. Captions and titles are escaped in both JSX and generated HTML. Invalid saved URLs do not create an iframe. No API key, additional backend, schema migration or live content rewrite is needed.

Embedding still contacts YouTube when the iframe loads. Private, removed, age-restricted or embedding-disabled videos may not play; this feature does not bypass those restrictions.

## Verification

- `node --import tsx --test packages/cms/src/posts/*.test.ts packages/cms/src/posts/*.test.tsx`
- `pnpm exec tsc -p apps/web --noEmit`
- `node scripts/test-blog-youtube-browser.cjs`

The browser regression uses the real preview component with Payload's form/block contexts and the actual public RichText component at 320, 375, 768 and 1280 pixels. The surrounding drawer shell and YouTube player are deterministic test doubles. It validates responsive geometry, invalid input, URL changes, accessibility attributes and long captions without a live admin login or post write. Screenshot evidence is uploaded by the Payload blog editor contracts workflow. Real playback and authenticated save/publish remain deployment smoke checks.
