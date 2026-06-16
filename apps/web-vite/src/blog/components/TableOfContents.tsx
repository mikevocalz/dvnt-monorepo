// src/blog/components/TableOfContents.tsx
// Parses h2/h3 headings from contentHtml, renders sticky TOC on desktop.
// Highlights the active section via IntersectionObserver.
import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Nav } from '@expo/html-elements'
import { color, font, space, radius, SANS, MONO } from '../../dashboard/theme/tokens'

type TocEntry = { id: string; text: string; level: 2 | 3 }

function parseHeadings(html: string): TocEntry[] {
  const entries: TocEntry[] = []
  const re = /<h([23])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h[23]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    entries.push({
      level: parseInt(m[1], 10) as 2 | 3,
      id: m[2],
      text: m[3].replace(/<[^>]+>/g, '').trim(),
    })
  }
  return entries
}

type Props = {
  contentHtml?: string
}

export function TableOfContents({ contentHtml }: Props) {
  const [active, setActive] = useState('')
  const entries = contentHtml ? parseHeadings(contentHtml) : []

  useEffect(() => {
    if (!entries.length || typeof IntersectionObserver === 'undefined') return

    const ids = entries.map((e) => e.id)
    const map = new Map<string, number>()

    const observer = new IntersectionObserver(
      (obs) => {
        obs.forEach((entry) => {
          map.set(entry.target.id, entry.isIntersecting ? 1 : 0)
        })
        const first = ids.find((id) => map.get(id))
        if (first) setActive(first)
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    )

    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [contentHtml])

  if (!entries.length) return null

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      const offset = 80
      const top = el.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }

  return (
    <Nav style={s.root} aria-label="Table of contents">
      <Text style={s.heading}>On this page</Text>
      {entries.map((entry) => {
        const isActive = active === entry.id
        return (
          <Pressable
            key={entry.id}
            onPress={() => scrollTo(entry.id)}
            style={({ hovered }: any) => [
              s.item,
              entry.level === 3 && s.itemL3,
              isActive && s.itemActive,
              hovered && !isActive && s.itemHover,
            ]}
            accessibilityRole="link"
            accessibilityLabel={`Jump to: ${entry.text}`}
          >
            {isActive && <View style={s.activeDot} />}
            <Text
              style={[
                s.itemText,
                entry.level === 3 && s.itemTextL3,
                isActive && s.itemTextActive,
              ]}
              numberOfLines={2}
            >
              {entry.text}
            </Text>
          </Pressable>
        )
      })}
    </Nav>
  )
}

const s = StyleSheet.create({
  root: {
    position: 'sticky' as any,
    top: 100,
    gap: 2 as any,
    maxWidth: 220,
  },
  heading: {
    color: color.textFaint,
    fontSize: 9,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase' as any,
    marginBottom: space.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8 as any,
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  itemL3: { paddingLeft: space.xl },
  itemActive: {
    borderLeftColor: color.brand,
    backgroundColor: 'rgba(255,91,252,0.07)',
  },
  itemHover: { backgroundColor: 'rgba(255,255,255,0.04)' },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.brand,
    marginTop: 6,
    flexShrink: 0,
  },
  itemText: {
    color: color.textDim,
    fontSize: font.xs,
    fontFamily: SANS as any,
    lineHeight: 18,
    flex: 1,
  },
  itemTextL3: { color: color.textFaint },
  itemTextActive: { color: color.text, fontWeight: '600' },
})
