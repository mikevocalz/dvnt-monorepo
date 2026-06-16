'use client'
// Magnetic / tilt enhancement for index post cards. Attaches a pointer-follow
// 3D tilt + lift to every `.dvnt-card`, set with !important so it overrides the
// CSS hover lift while the pointer is engaged and cleanly reverts on leave.
// Gated to fine pointers (no phantom tilt on touch) and disabled under
// prefers-reduced-motion — the static fallback is the existing CSS hover lift.
import { useEffect } from 'react'

const MAX_DEG = 5

export function MagneticCards({ selector = '.dvnt-card' }: { selector?: string }) {
  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!finePointer || reduce) return

    const cards = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
    const cleanups: Array<() => void> = []

    for (const card of cards) {
      card.classList.add('dvnt-tilt')

      const onMove = (e: PointerEvent) => {
        const r = card.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        const rx = (-py * MAX_DEG).toFixed(2)
        const ry = (px * MAX_DEG).toFixed(2)
        card.style.setProperty(
          'transform',
          `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`,
          'important',
        )
      }
      const onLeave = () => card.style.removeProperty('transform')

      card.addEventListener('pointermove', onMove)
      card.addEventListener('pointerleave', onLeave)
      cleanups.push(() => {
        card.removeEventListener('pointermove', onMove)
        card.removeEventListener('pointerleave', onLeave)
        card.classList.remove('dvnt-tilt')
        card.style.removeProperty('transform')
      })
    }

    return () => cleanups.forEach((fn) => fn())
  }, [selector])

  return null
}
