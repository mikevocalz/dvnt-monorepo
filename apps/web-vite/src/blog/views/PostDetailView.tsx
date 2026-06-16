// src/blog/views/PostDetailView.tsx — CLIENT-ONLY render of the article detail.
// react-native(-web) + @expo/html-elements can't SSR in this TanStack/RSC/Vite
// runtime, so all RN-web rendering lives here; the route (blog.$slug.tsx)
// lazy-imports it behind a mount gate.
import { useEffect } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { Main, Article, Header, Section, H1, H2, Span, A } from '@expo/html-elements'
import { mediaUrl } from '../api'
import { setRouteCtx, addBreadcrumb } from '../sentry'
import { BylineBlock, AuthorFooterCards } from '../components/BylineBlock'
import { CategoryBadge } from '../components/CategoryBadge'
import { ArticleCard } from '../components/ArticleCard'
import { ScrollProgress } from '../components/ScrollProgress'
import { TableOfContents } from '../components/TableOfContents'
import { ShareBar } from '../components/ShareBar'
import { RichTextRenderer } from '../components/RichTextRenderer'
import { NewsletterCTA } from '../components/NewsletterCTA'
import { color, font, space, SANS, MONO } from '../../dashboard/theme/tokens'
import type { BlogPostCard } from '../api'

export function PostDetailView({ post, latest }: { post: any; latest: BlogPostCard[] }) {
  useEffect(() => {
    setRouteCtx({ route: '/blog/:slug', slug: post.slug })
    addBreadcrumb('post.opened', `Opened post: ${post.slug}`, { slug: post.slug })
  }, [post.slug])

  const heroSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : null
  const primaryCat = post.categories?.[0]

  return (
    <View style={s.shell}>
      <ScrollProgress />
      <A href="#article-body" style={s.skipLink}>
        <Span style={s.skipText}>Skip to content</Span>
      </A>

      <Header style={s.masthead}>
        <View style={s.mastheadInner}>
          <A href="/blog" style={s.mastheadBack}>
            <Span style={s.mastheadBackText}>← DVNT Magazine</Span>
          </A>
          {primaryCat && <CategoryBadge category={primaryCat} size="sm" />}
        </View>
      </Header>

      <Main style={s.main} nativeID="article-body">
        <View style={s.hero}>
          {heroSrc && (
            <View style={s.heroImgWrap}>
              <Image source={{ uri: heroSrc }} style={s.heroImg} />
              <View style={s.heroOverlay} pointerEvents="none" />
            </View>
          )}
          <View style={[s.heroBody, !heroSrc && s.heroBodyNoImg]}>
            <View style={s.heroBodyInner}>
              <View style={s.heroMeta}>
                {primaryCat && <CategoryBadge category={primaryCat} size="md" />}
                {post.eyebrow && !primaryCat && <Text style={s.eyebrow}>{post.eyebrow}</Text>}
              </View>
              <H1 style={s.title}>{post.title}</H1>
              {post.excerpt && <Text style={s.dek}>{post.excerpt}</Text>}
              <View style={s.bylineWrap}>
                <BylineBlock
                  authors={post.authors}
                  contributors={post.contributors}
                  publishedAt={post.publishedAt}
                  updatedAt={post.updatedAt}
                  readTime={post.readTime}
                  variant="hero"
                />
              </View>
            </View>
          </View>
        </View>

        {post.heroCaption && (
          <View style={s.heroCaptionWrap}>
            <Text style={s.heroCaption}>{post.heroCaption}</Text>
          </View>
        )}

        <View style={s.articleLayout}>
          <View style={s.shareSidebar}>
            <ShareBar title={post.title} url={typeof window !== 'undefined' ? window.location.href : undefined} />
          </View>
          <Article style={s.articleBody}>
            {post.contentHtml ? (
              <RichTextRenderer html={post.contentHtml} slug={post.slug} />
            ) : (
              <Text style={s.noContent}>Full article content coming soon.</Text>
            )}
            <NewsletterCTA />
          </Article>
          <View style={s.tocSidebar}>
            <TableOfContents contentHtml={post.contentHtml} />
          </View>
        </View>

        <View style={s.authorSection}>
          <AuthorFooterCards authors={post.authors} contributors={post.contributors} />
        </View>

        {latest.length > 0 && (
          <Section style={s.relatedSection}>
            <View style={s.relatedHeader}>
              <Text style={s.relatedKicker}>— More to read</Text>
              <H2 style={s.relatedTitle}>Latest stories</H2>
            </View>
            <View style={s.relatedGrid}>
              {latest.map((p: BlogPostCard) => (
                <View key={p.id} style={s.relatedItem}>
                  <ArticleCard post={p} size="secondary" />
                </View>
              ))}
            </View>
            <View style={s.relatedFooter}>
              <A href="/blog" style={s.backLink}>
                <Span style={s.backLinkText}>View all stories →</Span>
              </A>
            </View>
          </Section>
        )}
      </Main>

      <View style={s.footer}>
        <Text style={s.footerText}>© {new Date().getFullYear()} DVNT. All rights reserved.</Text>
        <View style={s.footerLinks}>
          <A href="/blog" style={s.footerLink}><Span style={s.footerLinkText}>Magazine</Span></A>
          <A href="https://dvntapp.live" style={s.footerLink}><Span style={s.footerLinkText}>App</Span></A>
        </View>
      </View>
    </View>
  )
}

export function PostNotFoundView() {
  return (
    <View style={nf.root}>
      <Text style={nf.title}>Story not found</Text>
      <A href="/blog" style={nf.link}><Span style={nf.linkText}>← Back to Magazine</Span></A>
    </View>
  )
}

const MAX = 1280
const BODY_MAX = 740

const s = StyleSheet.create({
  shell: { flex: 1, minHeight: '100vh' as any, backgroundColor: color.bg },
  skipLink: { position: 'absolute' as any, left: -9999, top: -9999, opacity: 0 },
  skipText: { color: color.text, fontSize: font.sm },
  masthead: { position: 'sticky' as any, top: 0, zIndex: 50, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(2,3,10,0.85)', backdropFilter: 'saturate(180%) blur(20px)' as any },
  mastheadInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: MAX, width: '100%' as any, marginHorizontal: 'auto' as any, paddingHorizontal: space.xl, paddingVertical: 14 },
  mastheadBack: { textDecorationLine: 'none' as any },
  mastheadBackText: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any, fontWeight: '600', letterSpacing: 0.5 },
  main: { maxWidth: MAX, width: '100%' as any, marginHorizontal: 'auto' as any, paddingHorizontal: space.xl, paddingBottom: space.xxl * 2, zIndex: 1, position: 'relative' as any },
  hero: { marginHorizontal: -space.xl, position: 'relative' as any, marginBottom: space.xl },
  heroImgWrap: { width: '100%' as any, aspectRatio: 21 / 9, position: 'relative' as any, overflow: 'hidden' },
  heroImg: { width: '100%' as any, height: '100%' as any, objectFit: 'cover' as any },
  heroOverlay: { position: 'absolute' as any, left: 0, right: 0, bottom: 0, height: '70%', backgroundImage: 'linear-gradient(to top, rgba(2,3,10,1) 0%, rgba(2,3,10,0.6) 40%, transparent 100%)' as any },
  heroBody: { position: 'absolute' as any, left: 0, right: 0, bottom: 0, padding: space.xl },
  heroBodyNoImg: { position: 'relative' as any, paddingTop: space.xxl },
  heroBodyInner: { maxWidth: BODY_MAX, gap: space.md as any },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.md as any },
  eyebrow: { color: color.cyan, fontSize: 10, fontFamily: MONO as any, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' as any },
  title: { color: color.text, fontSize: 40, fontWeight: '900', fontFamily: SANS as any, letterSpacing: -1, lineHeight: 48 },
  dek: { color: 'rgba(245,245,244,0.75)', fontSize: 20, lineHeight: 30, fontFamily: SANS as any, maxWidth: 560 },
  bylineWrap: { marginTop: space.sm },
  heroCaptionWrap: { paddingHorizontal: space.xl, paddingBottom: space.md, marginHorizontal: -space.xl, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  heroCaption: { color: color.textFaint, fontSize: 11, fontFamily: MONO as any, letterSpacing: 0.3 },
  articleLayout: { flexDirection: 'row', gap: space.xxl as any, paddingTop: space.xxl, alignItems: 'flex-start' },
  shareSidebar: { width: 48, flexShrink: 0 },
  articleBody: { flex: 1, minWidth: 0, maxWidth: BODY_MAX, gap: space.xl as any },
  tocSidebar: { width: 220, flexShrink: 0 },
  noContent: { color: color.textDim, fontSize: font.md, fontStyle: 'italic' as any },
  authorSection: { marginTop: space.xxl * 2, maxWidth: BODY_MAX },
  relatedSection: { marginTop: space.xxl * 2, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: space.xxl, gap: space.xl as any },
  relatedHeader: { gap: 6 as any },
  relatedKicker: { color: color.cyan, fontSize: 10, fontFamily: MONO as any, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' as any },
  relatedTitle: { color: color.text, fontSize: 26, fontWeight: '800', fontFamily: SANS as any, letterSpacing: -0.4 },
  relatedGrid: { flexDirection: 'row', flexWrap: 'wrap' as any, gap: space.lg as any },
  relatedItem: { flexBasis: '30%' as any, flexGrow: 1, minWidth: 260 },
  relatedFooter: { alignItems: 'center', paddingTop: space.md },
  backLink: { textDecorationLine: 'none' as any },
  backLinkText: { color: color.brand, fontSize: font.sm, fontWeight: '600', fontFamily: MONO as any, letterSpacing: 0.5 },
  footer: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingVertical: space.xl, paddingHorizontal: space.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as any, gap: space.md as any, maxWidth: MAX, width: '100%' as any, marginHorizontal: 'auto' as any },
  footerText: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
  footerLinks: { flexDirection: 'row', gap: space.lg as any },
  footerLink: { textDecorationLine: 'none' as any },
  footerLinkText: { color: color.textFaint, fontSize: font.xs },
})

const nf = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: '60vh' as any, gap: space.lg as any },
  title: { color: color.text, fontSize: 24, fontWeight: '700', fontFamily: SANS as any },
  link: { textDecorationLine: 'none' as any },
  linkText: { color: color.brand, fontSize: font.md },
})
