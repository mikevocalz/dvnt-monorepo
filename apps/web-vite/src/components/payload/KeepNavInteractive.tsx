'use client'
import { useEffect } from 'react'

// On desktop (≥1025px) we force the sidebar permanently visible (see `.nav` rules
// in payload-overrides.css). But Payload treats the nav as "closed" and marks the
// <aside class="nav"> with the `inert` attribute — which leaves it visible yet
// makes the WHOLE sidebar non-interactive: every click silently falls through to
// the content area behind it (computed `pointer-events` still reads `auto`, so it
// looks fine — `inert` is the hidden culprit). Strip `inert` on desktop so the
// always-open sidebar responds to clicks; on tablet/phone (≤1024px) RESTORE it so
// the off-canvas drawer's closed state stays correctly inert. The breakpoint must
// match the CSS (1024) or a resized-down window keeps a stale, click-eating nav.
const DESKTOP = '(min-width: 1025px)'
export default function KeepNavInteractive() {
  useEffect(() => {
    const nav = document.querySelector('aside.nav') as HTMLElement | null
    if (!nav) return
    const mq = window.matchMedia(DESKTOP)
    let selfMutating = false
    const sync = () => {
      // Desktop: ensure NOT inert (clickable sidebar). Tablet/phone: leave
      // Payload's inert in place so the closed drawer is correctly inert.
      const wantInert = !mq.matches
      if (!wantInert && nav.hasAttribute('inert')) {
        selfMutating = true
        nav.removeAttribute('inert')
        selfMutating = false
      }
    }
    sync()
    // Re-apply if Payload re-adds inert (e.g. nav state changes), ignoring our
    // own mutations to avoid a feedback loop.
    const mo = new MutationObserver(() => { if (!selfMutating) sync() })
    mo.observe(nav, { attributes: true, attributeFilter: ['inert'] })
    mq.addEventListener('change', sync)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', sync)
    }
  }, [])
  return null
}
