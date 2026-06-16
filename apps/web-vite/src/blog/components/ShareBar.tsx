// src/blog/components/ShareBar.tsx
// Sticky share actions: clipboard copy, Twitter/X, native share.
// Renders as a fixed vertical strip on desktop, horizontal bar on mobile.
import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { addBreadcrumb } from '../sentry'
import { color, space, font, radius, MONO } from '../../dashboard/theme/tokens'

type Props = {
  title: string
  url?: string
}

export function ShareBar({ title, url }: Props) {
  const [copied, setCopied] = useState(false)

  const href = url ?? (typeof window !== 'undefined' ? window.location.href : '')

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      addBreadcrumb('share.clicked', 'Copied link', { url: href })
    } catch {
      /* clipboard unavailable */
    }
  }

  const shareX = () => {
    const text = encodeURIComponent(`${title} — ${href}`)
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank', 'noopener,noreferrer')
    addBreadcrumb('share.clicked', 'Shared to X', { url: href })
  }

  const nativeShare = async () => {
    try {
      await navigator.share?.({ title, url: href })
      addBreadcrumb('share.clicked', 'Native share', { url: href })
    } catch {
      /* user cancelled */
    }
  }

  return (
    <View style={s.bar} aria-label="Share this article">
      <Text style={s.label}>Share</Text>

      <Pressable onPress={copyLink} style={({ hovered }: any) => [s.btn, hovered && s.btnHover]} accessibilityLabel="Copy link">
        <Text style={s.icon}>{copied ? '✓' : '🔗'}</Text>
        {copied && <Text style={s.confirm}>Copied!</Text>}
      </Pressable>

      <Pressable onPress={shareX} style={({ hovered }: any) => [s.btn, hovered && s.btnHover]} accessibilityLabel="Share on X">
        <Text style={s.icon}>𝕏</Text>
      </Pressable>

      {typeof navigator !== 'undefined' && 'share' in navigator && (
        <Pressable onPress={nativeShare} style={({ hovered }: any) => [s.btn, hovered && s.btnHover]} accessibilityLabel="More share options">
          <Text style={s.icon}>↗</Text>
        </Pressable>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    position: 'sticky' as any,
    top: 88,
    flexDirection: 'column',
    alignItems: 'center',
    gap: space.xs as any,
    padding: space.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: radius.xl,
    backgroundColor: 'rgba(8,10,20,0.72)',
    backdropFilter: 'saturate(160%) blur(18px)' as any,
    alignSelf: 'flex-start' as any,
  },
  label: {
    color: color.textFaint,
    fontSize: 9,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase' as any,
    marginBottom: 2,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  btnHover: { backgroundColor: 'rgba(255,91,252,0.15)' },
  icon: { color: color.text, fontSize: 14 },
  confirm: {
    position: 'absolute' as any,
    left: 40,
    color: color.brand,
    fontSize: font.xs,
    fontFamily: MONO as any,
    whiteSpace: 'nowrap' as any,
  },
})
