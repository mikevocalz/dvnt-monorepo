// src/blog/components/CategoryBadge.tsx
// DVNT-flavored category pill. Uses the category's accentColor or falls back
// to brand magenta. Built on react-native + @expo/html-elements.
import { View, Text, StyleSheet } from 'react-native'
import { A } from '@expo/html-elements'
import type { BlogCategory } from '../api'
import { color, font, space, radius, MONO } from '../../dashboard/theme/tokens'

type Props = {
  category: BlogCategory
  link?: boolean
  size?: 'sm' | 'md'
}

export function CategoryBadge({ category, link = true, size = 'sm' }: Props) {
  const accent = category.accentColor ?? color.brand
  const bg = `${accent}22` // ~13% opacity

  const pill = (
    <View
      style={[
        s.pill,
        size === 'md' && s.pillMd,
        { backgroundColor: bg, borderColor: `${accent}44` },
      ]}
    >
      <Text
        style={[s.label, size === 'md' && s.labelMd, { color: accent }]}
        numberOfLines={1}
      >
        {category.title}
      </Text>
    </View>
  )

  if (!link) return pill

  return (
    <A
      href={`/blog/category/${category.slug}`}
      style={s.anchor}
      accessibilityLabel={`View ${category.title} posts`}
    >
      {pill}
    </A>
  )
}

const s = StyleSheet.create({
  anchor: { textDecorationLine: 'none' as any, alignSelf: 'flex-start' as any },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 3,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  pillMd: { paddingHorizontal: space.lg, paddingVertical: 5 },
  label: {
    fontSize: 10,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase' as any,
  },
  labelMd: { fontSize: 11, letterSpacing: 1.8 },
})
