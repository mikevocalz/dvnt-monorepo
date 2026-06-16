// src/blog/components/ArticleCard.tsx
// Three layout variants: 'lead' (full-width hero), 'secondary' (grid card),
// 'horizontal' (sidebar/related). All use RN + @expo/html-elements + DVNT tokens.
import { View, Text, Image, StyleSheet, Pressable } from 'react-native'
import { Article, A, Time } from '@expo/html-elements'
import type { BlogPostCard } from '../api'
import { mediaUrl, formatByline, formatDateShort } from '../api'
import { CategoryBadge } from './CategoryBadge'
import { BylineBlock } from './BylineBlock'
import { color, font, space, radius, SANS, MONO } from '../../dashboard/theme/tokens'

export type CardSize = 'lead' | 'secondary' | 'horizontal' | 'compact'

type Props = {
  post: BlogPostCard
  size?: CardSize
  priority?: boolean
}

// ─── Lead card — full-width cinematic hero ─────────────────────────────────

function LeadCard({ post, priority }: { post: BlogPostCard; priority?: boolean }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : null
  const cat = post.categories?.[0]

  return (
    <Article style={lead.root}>
      {/* Media */}
      <A href={`/blog/${post.slug}`} style={lead.mediaLink} aria-hidden="true" tabIndex={-1}>
        <View style={lead.mediaWrap}>
          {imgSrc ? (
            <Image
              source={{ uri: imgSrc }}
              style={lead.img}
             
            />
          ) : (
            <View style={lead.imgFallback} />
          )}
          {/* Dark gradient overlay */}
          <View style={lead.overlay} pointerEvents="none" />
          {/* Glow pulse top-right */}
          <View style={lead.glow} pointerEvents="none" />
        </View>
      </A>

      {/* Body — lives over the image on desktop, below on mobile */}
      <View style={lead.body}>
        {cat && <CategoryBadge category={cat} />}
        {post.eyebrow && !cat && (
          <Text style={lead.eyebrow}>{post.eyebrow}</Text>
        )}
        <A href={`/blog/${post.slug}`} style={lead.titleLink}>
          <Text style={lead.title}>{post.title}</Text>
        </A>
        {post.excerpt ? (
          <Text style={lead.excerpt} numberOfLines={3}>{post.excerpt}</Text>
        ) : null}
        <BylineBlock
          authors={post.authors}
          contributors={post.contributors}
          publishedAt={post.publishedAt}
          readTime={post.readTime}
          variant="card"
        />
      </View>
    </Article>
  )
}

// ─── Secondary card — editorial grid tile ──────────────────────────────────

function SecondaryCard({ post }: { post: BlogPostCard }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : null
  const cat = post.categories?.[0]

  return (
    <Article style={sec.root}>
      <A href={`/blog/${post.slug}`} style={sec.mediaLink} aria-hidden="true" tabIndex={-1}>
        <View style={sec.mediaWrap}>
          {imgSrc ? (
            <Image source={{ uri: imgSrc }} style={sec.img} />
          ) : (
            <View style={sec.imgFallback} />
          )}
          <View style={sec.overlay} pointerEvents="none" />
        </View>
      </A>

      <View style={sec.body}>
        {cat && <CategoryBadge category={cat} />}
        <A href={`/blog/${post.slug}`} style={sec.titleLink}>
          <Text style={sec.title} numberOfLines={3}>{post.title}</Text>
        </A>
        {post.excerpt ? (
          <Text style={sec.excerpt} numberOfLines={2}>{post.excerpt}</Text>
        ) : null}
        <View style={sec.meta}>
          {post.authors?.[0] && (
            <View style={sec.authorRow}>
              {post.authors[0].avatar && (
                <Image
                  source={{ uri: mediaUrl(post.authors[0].avatar, 'thumbnail') }}
                  style={sec.avatar}
                />
              )}
              <Text style={sec.byline} numberOfLines={1}>
                {formatByline(post.authors)}
              </Text>
            </View>
          )}
          <View style={sec.dateRow}>
            {post.publishedAt && (
              <Time dateTime={post.publishedAt} style={sec.date}>
                {formatDateShort(post.publishedAt)}
              </Time>
            )}
            {post.readTime ? (
              <Text style={sec.readTime}>{post.readTime} min</Text>
            ) : null}
          </View>
        </View>
      </View>
    </Article>
  )
}

// ─── Horizontal card — sidebar / related posts ─────────────────────────────

function HorizontalCard({ post }: { post: BlogPostCard }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : null
  const cat = post.categories?.[0]

  return (
    <Article style={hz.root}>
      <A href={`/blog/${post.slug}`} style={hz.mediaLink} aria-hidden="true" tabIndex={-1}>
        <View style={hz.mediaWrap}>
          {imgSrc ? (
            <Image source={{ uri: imgSrc }} style={hz.img} />
          ) : (
            <View style={hz.imgFallback} />
          )}
        </View>
      </A>
      <View style={hz.body}>
        {cat && <CategoryBadge category={cat} />}
        <A href={`/blog/${post.slug}`} style={hz.titleLink}>
          <Text style={hz.title} numberOfLines={3}>{post.title}</Text>
        </A>
        <View style={hz.meta}>
          {post.publishedAt && (
            <Time dateTime={post.publishedAt} style={hz.date}>
              {formatDateShort(post.publishedAt)}
            </Time>
          )}
          {post.readTime ? (
            <Text style={hz.readTime}>{post.readTime} min</Text>
          ) : null}
        </View>
      </View>
    </Article>
  )
}

// ─── Compact card — numbered list style ────────────────────────────────────

function CompactCard({ post, index }: { post: BlogPostCard; index?: number }) {
  const cat = post.categories?.[0]
  return (
    <Article style={cmp.root}>
      {typeof index === 'number' && (
        <Text style={cmp.num} aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </Text>
      )}
      <View style={cmp.body}>
        {cat && <CategoryBadge category={cat} />}
        <A href={`/blog/${post.slug}`} style={cmp.titleLink}>
          <Text style={cmp.title} numberOfLines={2}>{post.title}</Text>
        </A>
        {post.publishedAt && (
          <Time dateTime={post.publishedAt} style={cmp.date}>
            {formatDateShort(post.publishedAt)}
          </Time>
        )}
      </View>
    </Article>
  )
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────

export function ArticleCardSkeleton({ size = 'secondary' }: { size?: CardSize }) {
  return (
    <View
      style={[
        sk.root,
        size === 'lead' && sk.leadRoot,
        size === 'horizontal' && sk.hzRoot,
      ]}
    >
      <View style={[sk.img, size === 'horizontal' && sk.hzImg, size === 'lead' && sk.leadImg]} />
      <View style={sk.body}>
        <View style={[sk.line, sk.tag]} />
        <View style={[sk.line, sk.titleLine]} />
        <View style={[sk.line, sk.titleLineSm]} />
        {size !== 'horizontal' && size !== 'compact' && (
          <>
            <View style={[sk.line, sk.excerpt]} />
            <View style={[sk.line, sk.excerptSm]} />
          </>
        )}
        <View style={[sk.line, sk.meta]} />
      </View>
    </View>
  )
}

// ─── Exports ─────────────────────────────────────────────────────────────

export function ArticleCard({
  post,
  size = 'secondary',
  priority = false,
}: Props & { index?: number }) {
  if (size === 'lead') return <LeadCard post={post} priority={priority} />
  if (size === 'horizontal') return <HorizontalCard post={post} />
  if (size === 'compact') return <CompactCard post={post} />
  return <SecondaryCard post={post} />
}

// ─── Styles ───────────────────────────────────────────────────────────────

const GLASS_BG = 'rgba(8,10,20,0.72)'
const GLASS_BORDER = 'rgba(255,255,255,0.09)'
const CARD_RADIUS = radius.xl

const lead = StyleSheet.create({
  root: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  mediaLink: { textDecorationLine: 'none' as any },
  mediaWrap: { width: '100%', aspectRatio: 16 / 9, position: 'relative' },
  img: { width: '100%', height: '100%' },
  imgFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(138,64,207,0.18)',
  },
  overlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: '60%',
    background: 'linear-gradient(to top, rgba(2,3,10,0.95) 0%, transparent 100%)' as any,
  },
  glow: {
    position: 'absolute',
    top: 0, right: 0,
    width: '50%', height: '50%',
    backgroundImage: 'radial-gradient(60% 50% at 80% 10%, rgba(138,64,207,0.25) 0%, transparent 80%)' as any,
    pointerEvents: 'none' as any,
  },
  body: {
    padding: space.xl,
    gap: space.md as any,
    backgroundColor: GLASS_BG,
    backdropFilter: 'saturate(160%) blur(18px)' as any,
  },
  eyebrow: {
    color: color.cyan,
    fontSize: 10,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase' as any,
  },
  titleLink: { textDecorationLine: 'none' as any },
  title: {
    color: color.text,
    fontSize: 28,
    fontWeight: '800',
    fontFamily: SANS as any,
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  excerpt: {
    color: color.textDim,
    fontSize: font.md,
    lineHeight: 26,
    maxWidth: 560,
  },
})

const sec = StyleSheet.create({
  root: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: GLASS_BG,
  },
  mediaLink: { textDecorationLine: 'none' as any },
  mediaWrap: { width: '100%', aspectRatio: 3 / 2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  imgFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(138,64,207,0.15)',
  },
  overlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: '40%',
    background: 'linear-gradient(to top, rgba(8,10,20,0.8) 0%, transparent 100%)' as any,
  },
  body: {
    padding: space.lg,
    gap: 8 as any,
  },
  titleLink: { textDecorationLine: 'none' as any },
  title: {
    color: color.text,
    fontSize: font.lg,
    fontWeight: '700',
    fontFamily: SANS as any,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  excerpt: {
    color: color.textDim,
    fontSize: font.sm,
    lineHeight: 22,
  },
  meta: { gap: 4 as any },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 as any },
  avatar: { width: 18, height: 18, borderRadius: 9 },
  byline: { color: color.textFaint, fontSize: font.xs, flex: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 as any },
  date: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
  readTime: {
    color: color.textFaint,
    fontSize: font.xs,
    fontFamily: MONO as any,
  },
})

const hz = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: space.md as any,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  mediaLink: { textDecorationLine: 'none' as any, flexShrink: 0 },
  mediaWrap: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
    overflow: 'hidden',
    flexShrink: 0,
  },
  img: { width: '100%', height: '100%' },
  imgFallback: { width: '100%', height: '100%', backgroundColor: 'rgba(138,64,207,0.15)' },
  body: { flex: 1, gap: 6 as any },
  titleLink: { textDecorationLine: 'none' as any },
  title: {
    color: color.text,
    fontSize: font.sm,
    fontWeight: '700',
    fontFamily: SANS as any,
    lineHeight: 20,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 as any },
  date: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
  readTime: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
})

const cmp = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: space.lg as any,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    alignItems: 'flex-start',
  },
  num: {
    color: 'rgba(255,91,252,0.4)',
    fontSize: 24,
    fontWeight: '800',
    fontFamily: MONO as any,
    lineHeight: 28,
    width: 36,
    flexShrink: 0,
  },
  body: { flex: 1, gap: 5 as any },
  titleLink: { textDecorationLine: 'none' as any },
  title: {
    color: color.text,
    fontSize: font.sm,
    fontWeight: '700',
    fontFamily: SANS as any,
    lineHeight: 20,
  },
  date: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
})

const sk = StyleSheet.create({
  root: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: GLASS_BG,
  },
  leadRoot: {},
  hzRoot: {
    flexDirection: 'row',
    gap: space.md as any,
    paddingVertical: space.md,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'transparent',
  },
  img: { width: '100%', aspectRatio: 3 / 2, backgroundColor: 'rgba(255,255,255,0.05)' },
  leadImg: { aspectRatio: 16 / 9 },
  hzImg: { width: 88, height: 64, aspectRatio: undefined, flexShrink: 0, borderRadius: radius.md },
  body: { padding: space.lg, gap: 10 as any },
  line: {
    height: 14,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  tag: { width: 64, height: 10 },
  titleLine: { width: '90%', height: 18 },
  titleLineSm: { width: '60%', height: 18 },
  excerpt: { width: '100%', height: 12 },
  excerptSm: { width: '70%', height: 12 },
  meta: { width: 120, height: 10, marginTop: 4 },
})
