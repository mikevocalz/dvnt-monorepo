'use client'
// Article-body polish, applied imperatively so it is robust to whatever wrapper
// the Payload Lexical converter emits — and fully progressive: with JS off, the
// prose renders 100% visible (nothing is hidden in markup, so no FOUC / no LCP
// or CLS cost). Three jobs, all scoped to the prose container:
//   1. Anchor h2/h3 headings (slug ids) so the sticky TOC scroll-spy + smooth
//      jumps resolve — the ids match extractToc() in the post page exactly.
//   2. Add the gradient drop-cap class to the opening paragraph.
//   3. Staggered IntersectionObserver fade/translate reveal on content blocks.
// All motion is gated behind prefers-reduced-motion (static = fully visible).
import { useEffect } from 'react'

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const BLOCK_SELECTOR = 'p,h2,h3,h4,figure,blockquote,ul,ol,pre,img'

export function ScrollReveal({ selector = '.dvnt-prose' }: { selector?: string }) {
  useEffect(() => {
    const root = document.querySelector(selector)
    if (!root) return

    // 1. Heading anchors for the TOC.
    root.querySelectorAll('h2, h3').forEach((h) => {
      if (!h.id) {
        const id = slugify(h.textContent ?? '')
        if (id) h.id = id
      }
    })

    // Top-level content blocks (drop nested matches: img inside figure, etc.).
    const all = Array.from(root.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[]
    const blocks = all.filter((el) => !all.some((o) => o !== el && o.contains(el)))

    // 2. Drop-cap on the first paragraph.
    blocks.find((el) => el.tagName === 'P')?.classList.add('dvnt-dropcap')

    // 3. Scroll reveal — skipped entirely under reduced-motion (content stays put).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    blocks.forEach((el, i) => {
      el.classList.add('dvnt-sr')
      el.style.transitionDelay = `${(i % 5) * 55}ms`
    })

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            ;(e.target as HTMLElement).classList.add('is-visible')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.04 },
    )
    blocks.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [selector])

  return null
}
