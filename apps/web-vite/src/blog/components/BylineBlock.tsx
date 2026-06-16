// src/blog/components/BylineBlock.tsx
// NYT-style byline: primary "By X and Y" row with stacked avatars,
// plus contributor credit lines "Photographs by Z".
// Built on react-native + @expo/html-elements, DVNT tokens.
import { View, Text, Image, StyleSheet, Pressable } from 'react-native'
import { A, Span, Time } from '@expo/html-elements'
import type { BlogAuthor, BlogContributor } from '../api'
import { mediaUrl, formatByline, formatDate } from '../api'
import { color, font, space, radius, SANS, MONO } from '../../dashboard/theme/tokens'

type Props = {
  authors?: BlogAuthor[]
  contributors?: BlogContributor[]
  publishedAt?: string
  updatedAt?: string
  readTime?: number
  variant?: 'hero' | 'card' | 'footer'
}

function AuthorAvatar({ author, size = 32 }: { author: BlogAuthor; size?: number }) {
  const src = author.avatar ? mediaUrl(author.avatar, 'thumbnail') : null
  const initials = author.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const r = Math.round(size * 0.5)

  return (
    <A
      href={author.profileUrl ?? `/blog/author/${author.slug}`}
      style={[av.wrap, { width: size, height: size, borderRadius: r }]}
      accessibilityLabel={`View profile of ${author.name}`}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size, borderRadius: r }}
        />
      ) : (
        <View style={[av.fallback, { width: size, height: size, borderRadius: r }]}>
          <Text style={[av.initials, { fontSize: size * 0.36 }]}>{initials}</Text>
        </View>
      )}
    </A>
  )
}

const av = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  fallback: {
    backgroundColor: 'rgba(138,64,207,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#fff',
    fontWeight: '700',
    fontFamily: SANS as any,
  },
})

export function BylineBlock({
  authors = [],
  contributors = [],
  publishedAt,
  updatedAt,
  readTime,
  variant = 'hero',
}: Props) {
  const isFooter = variant === 'footer'
  const avatarSize = isFooter ? 44 : variant === 'hero' ? 34 : 26

  // Group contributors by their role label
  const roleGroups = contributors.reduce<Record<string, BlogAuthor[]>>((acc, c) => {
    if (!acc[c.role]) acc[c.role] = []
    acc[c.role].push(c.author)
    return acc
  }, {})

  return (
    <View style={s.root}>
      {/* Primary byline row */}
      {authors.length > 0 && (
        <View style={s.bylineRow}>
          {/* Stacked avatars */}
          <View style={s.avatarStack}>
            {authors.map((a, i) => (
              <View
                key={a.id}
                style={[s.avatarWrap, i > 0 && { marginLeft: -avatarSize * 0.3 }]}
              >
                <AuthorAvatar author={a} size={avatarSize} />
              </View>
            ))}
          </View>

          <View style={s.bylineMeta}>
            {/* "By Alice Kim and Jordan Lee" */}
            <Text style={[s.bylineNames, isFooter && s.bylineNamesLg]}>
              <Span style={s.bylineBy}>By </Span>
              {authors.map((a, i) => (
                <Span key={a.id}>
                  <A
                    href={a.profileUrl ?? `/blog/author/${a.slug}`}
                    style={s.authorLink}
                  >
                    {a.name}
                  </A>
                  {isFooter && a.role ? (
                    <Span style={s.authorRole}>{`, ${a.role}`}</Span>
                  ) : null}
                  {i < authors.length - 2 ? (
                    <Span style={s.bylineBy}>{', '}</Span>
                  ) : i === authors.length - 2 ? (
                    <Span style={s.bylineBy}>{' and '}</Span>
                  ) : null}
                </Span>
              ))}
            </Text>

            {/* Date · read time */}
            {(publishedAt || readTime) && (
              <View style={s.metaRow}>
                {publishedAt && (
                  <Time dateTime={publishedAt} style={s.metaText}>
                    {formatDate(publishedAt)}
                  </Time>
                )}
                {publishedAt && readTime ? (
                  <Text style={s.metaDot} aria-hidden="true">·</Text>
                ) : null}
                {readTime ? (
                  <Text style={s.metaText}>{readTime} min read</Text>
                ) : null}
                {updatedAt && updatedAt !== publishedAt ? (
                  <>
                    <Text style={s.metaDot} aria-hidden="true">·</Text>
                    <Text style={s.metaText}>
                      {'Updated '}
                      <Time dateTime={updatedAt} style={s.metaText}>
                        {formatDate(updatedAt)}
                      </Time>
                    </Text>
                  </>
                ) : null}
              </View>
            )}
          </View>
        </View>
      )}

      {/* Contributor credit lines */}
      {Object.keys(roleGroups).length > 0 && (
        <View style={[s.contribBlock, authors.length > 0 && s.contribBlockSep]}>
          {Object.entries(roleGroups).map(([role, contribs]) => (
            <View key={role} style={s.contribRow}>
              <View style={s.contribAvatars}>
                {contribs.map((a, i) => (
                  <View
                    key={a.id}
                    style={i > 0 ? { marginLeft: -8 } : undefined}
                  >
                    <AuthorAvatar author={a} size={isFooter ? 28 : 20} />
                  </View>
                ))}
              </View>
              <Text style={s.contribText}>
                <Span style={s.contribRole}>{role + ' '}</Span>
                {contribs.map((a, i) => (
                  <Span key={a.id}>
                    <A
                      href={a.profileUrl ?? `/blog/author/${a.slug}`}
                      style={s.contribAuthorLink}
                    >
                      {a.name}
                    </A>
                    {i < contribs.length - 2 ? ', ' : i === contribs.length - 2 ? ' and ' : ''}
                  </Span>
                ))}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { gap: 4 as any },
  bylineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md as any },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { zIndex: 1 },
  bylineMeta: { flex: 1, gap: 3 as any },
  bylineNames: { color: color.text, fontSize: font.sm, fontFamily: SANS as any },
  bylineNamesLg: { fontSize: font.md },
  bylineBy: { color: color.textFaint },
  authorLink: {
    color: color.text,
    fontWeight: '600',
    textDecorationLine: 'none' as any,
  },
  authorRole: { color: color.textFaint, fontWeight: '400' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 as any, flexWrap: 'wrap' as any },
  metaText: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
  metaDot: { color: color.textFaint, fontSize: font.xs },
  contribBlock: { gap: 6 as any },
  contribBlockSep: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  contribRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm as any },
  contribAvatars: { flexDirection: 'row', alignItems: 'center' },
  contribText: { color: color.textFaint, fontSize: font.xs, fontFamily: SANS as any },
  contribRole: { fontStyle: 'italic' as any },
  contribAuthorLink: {
    color: 'rgba(245,245,244,0.72)',
    textDecorationLine: 'none' as any,
  },
})

// ─── Full author card shown at the foot of the article ────────────────────

export function AuthorFooterCards({
  authors = [],
  contributors = [],
}: {
  authors?: BlogAuthor[]
  contributors?: BlogContributor[]
}) {
  if (!authors.length && !contributors.length) return null

  const all = [
    ...authors.map((a) => ({ author: a, role: a.role ?? 'Staff Writer' })),
    ...contributors.map((c) => ({ author: c.author, role: c.role })),
  ]

  return (
    <View style={fc.root} accessibilityRole="region" aria-label="About the authors">
      <Text style={fc.heading}>About the authors</Text>
      {all.map(({ author, role }) => (
        <A
          key={author.id}
          href={author.profileUrl ?? `/blog/author/${author.slug}`}
          style={fc.card}
        >
          <AuthorAvatar author={author} size={52} />
          <View style={fc.cardBody}>
            <View style={fc.cardNameRow}>
              <Text style={fc.cardName}>{author.name}</Text>
              <Text style={fc.cardRole}>{role}</Text>
            </View>
            {author.bio ? (
              <Text style={fc.cardBio} numberOfLines={3}>{author.bio}</Text>
            ) : null}
            {author.socials && (
              <View style={fc.socials}>
                {author.socials.instagram && (
                  <A
                    href={`https://instagram.com/${author.socials.instagram.replace('@', '')}`}
                    style={fc.socialLink}
                    accessibilityLabel="Instagram"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Text style={fc.socialText}>IG</Text>
                  </A>
                )}
                {author.socials.twitter && (
                  <A
                    href={`https://x.com/${author.socials.twitter.replace('@', '')}`}
                    style={fc.socialLink}
                    accessibilityLabel="Twitter / X"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Text style={fc.socialText}>𝕏</Text>
                  </A>
                )}
                {author.socials.website && (
                  <A
                    href={author.socials.website}
                    style={fc.socialLink}
                    accessibilityLabel="Website"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Text style={fc.socialText}>Web</Text>
                  </A>
                )}
              </View>
            )}
          </View>
        </A>
      ))}
    </View>
  )
}

const fc = StyleSheet.create({
  root: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    paddingTop: space.xxl,
    gap: space.lg as any,
  },
  heading: {
    color: color.textFaint,
    fontSize: 11,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase' as any,
    marginBottom: space.sm,
  },
  card: {
    flexDirection: 'row',
    gap: space.lg as any,
    alignItems: 'flex-start',
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    textDecorationLine: 'none' as any,
  },
  cardBody: { flex: 1, gap: 6 as any },
  cardNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md as any, flexWrap: 'wrap' as any },
  cardName: {
    color: color.text,
    fontSize: font.md,
    fontWeight: '700',
    fontFamily: SANS as any,
  },
  cardRole: {
    color: color.cyan,
    fontSize: 11,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  cardBio: { color: color.textDim, fontSize: font.sm, lineHeight: 22 },
  socials: { flexDirection: 'row', gap: space.sm as any, marginTop: 4 },
  socialLink: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    textDecorationLine: 'none' as any,
  },
  socialText: { color: color.textDim, fontSize: font.xs, fontWeight: '600' },
})
