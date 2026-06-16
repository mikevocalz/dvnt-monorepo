// src/blog/components/ScrollProgress.tsx
// Thin reading-progress bar fixed to the top of the viewport.
// Uses plain useState + CSS width string — no Animated needed.
import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { color } from '../../dashboard/theme/tokens'

export function ScrollProgress() {
  const [pct, setPct] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      const docHeight =
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight
      setPct(docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!mounted) return null

  return (
    <View style={s.track} pointerEvents="none" aria-hidden="true">
      <View style={[s.bar, { width: `${pct}%` as any }]} />
    </View>
  )
}

const s = StyleSheet.create({
  track: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    zIndex: 9999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  bar: {
    height: '100%' as any,
    backgroundImage: `linear-gradient(90deg, ${color.brandAlt}, ${color.brand})` as any,
    transition: 'width 80ms linear' as any,
  },
})
