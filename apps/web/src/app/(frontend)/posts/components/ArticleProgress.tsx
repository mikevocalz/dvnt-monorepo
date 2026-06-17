'use client'
// Sticky scroll-progress bar pinned to the very top of the viewport.
// Painted on a <canvas> so it costs zero layout — just a rAF ticker.
import { useEffect, useRef } from 'react'

// Brand gradient (purple → blue), matching --dvnt-grad in dvnt-theme.css.
const GRADIENT = ['#5b2c81', '#743f92', '#2981af', '#379ed8']

export function ArticleProgress() {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    // Under reduced-motion the bar is hidden via CSS — don't burn a rAF loop.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let rafId = 0

    const tick = () => {
      const scrolled = window.scrollY
      const total = document.documentElement.scrollHeight - window.innerHeight
      const pct = total > 0 ? Math.min(scrolled / total, 1) : 0
      bar.style.transform = `scaleX(${pct})`
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <>
      <div
        ref={barRef}
        aria-hidden="true"
        data-progress
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: 9999,
          transformOrigin: 'left center',
          transform: 'scaleX(0)',
          background: `linear-gradient(90deg, ${GRADIENT.join(', ')})`,
          boxShadow: '0 0 12px rgba(55,158,216,0.53), 0 0 4px rgba(135,78,159,0.5)',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      />
      <style>{`@media(prefers-reduced-motion:reduce){[data-progress]{display:none}}`}</style>
    </>
  )
}
