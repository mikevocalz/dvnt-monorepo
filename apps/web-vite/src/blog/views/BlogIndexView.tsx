// src/blog/views/BlogIndexView.tsx — CLIENT-ONLY render of the blog index.
// react-native(-web) + @expo/html-elements can't be evaluated in this
// TanStack-Start/RSC/Vite SSR runtime (it crashes the whole server module
// graph). So all RN-web imports live here and the route (blog.index.tsx)
// lazy-imports this behind a mount gate — it only loads in the browser.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { Main, Section, Header, H1, H2, Nav, A, Span } from '@expo/html-elements'
import { fetchPostsIndex, type BlogPostCard, type BlogCategory } from '../api'
import { setRouteCtx } from '../sentry'
import { ArticleCard, ArticleCardSkeleton } from '../components/ArticleCard'
import { color, font, space, radius, SANS, MONO } from '../../dashboard/theme/tokens'

type Props = {
  featured: BlogPostCard | null
  editorsPicks: BlogPostCard[]
  trending: BlogPostCard[]
  categories: BlogCategory[]
  latest: { docs: BlogPostCard[] }
}

export function BlogIndexView({ featured, editorsPicks, trending, categories, latest }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [filterPosts, setFilterPosts] = useState<BlogPostCard[] | null>(null)
  const [filterLoading, setFilterLoading] = useState(false)

  useEffect(() => {
    setRouteCtx({ route: '/blog' })
  }, [])

  const filterByCategory = async (slug: string | null) => {
    setActiveCategory(slug)
    if (!slug) {
      setFilterPosts(null)
      return
    }
    setFilterLoading(true)
    const data = await fetchPostsIndex({ category: slug, limit: 16 })
    setFilterPosts(data.docs)
    setFilterLoading(false)
  }

  const displayPosts = filterPosts ?? latest.docs

  return (
    <View style={s.shell}>
      <View style={s.wash} pointerEvents="none" />

      <Header style={s.masthead}>
        <View style={s.mastheadInner}>
          <View style={s.mastheadLeft}>
            <A href="/blog" style={s.mastheadLogoLink}>
              <Text style={s.mastheadLogo}>DVNT</Text>
              <Text style={s.mastheadMag}>Magazine</Text>
            </A>
          </View>
          <Nav style={s.mastheadNav}>
            <A href="/" style={s.mastheadNavLink}><Span style={s.mastheadNavText}>Console</Span></A>
            <A href="/admin" style={s.mastheadNavLink}><Span style={s.mastheadNavText}>CMS</Span></A>
          </Nav>
        </View>
      </Header>

      <Main style={s.main}>
        {featured && (
          <Section style={s.heroSection}>
            <ArticleCard post={featured} size="lead" priority />
          </Section>
        )}

        {categories.length > 0 && (
          <View style={s.categoryRailWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categoryRail} contentContainerStyle={s.categoryRailContent}>
              <Pressable onPress={() => filterByCategory(null)} style={({ hovered }: any) => [s.catChip, !activeCategory && s.catChipActive, hovered && s.catChipHover]}>
                <Text style={[s.catChipText, !activeCategory && s.catChipTextActive]}>All</Text>
              </Pressable>
              {categories.map((cat: BlogCategory) => (
                <Pressable key={cat.id} onPress={() => filterByCategory(cat.slug)} style={({ hovered }: any) => [s.catChip, activeCategory === cat.slug && s.catChipActive, hovered && s.catChipHover]}>
                  <Text style={[s.catChipText, activeCategory === cat.slug && s.catChipTextActive]}>{cat.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {editorsPicks.length > 0 && !activeCategory && (
          <Section style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionKicker}>✦ Curated</Text>
              <H2 style={s.sectionTitle}>Editor's Picks</H2>
            </View>
            <View style={s.grid4}>
              {editorsPicks.map((post: BlogPostCard) => (
                <View key={post.id} style={s.gridItem4}>
                  <ArticleCard post={post} size="secondary" />
                </View>
              ))}
            </View>
          </Section>
        )}

        {trending.length > 0 && !activeCategory && (
          <Section style={s.section}>
            <View style={s.trendingLayout}>
              <View style={s.trendingLeft}>
                <View style={s.sectionHeader}>
                  <Text style={s.sectionKicker}>↑ Trending</Text>
                  <H2 style={s.sectionTitle}>Right now</H2>
                </View>
                {trending.slice(0, 3).map((post: BlogPostCard) => (
                  <ArticleCard key={post.id} post={post} size="compact" />
                ))}
              </View>
              <View style={s.trendingRight}>
                {trending.slice(3, 6).map((post: BlogPostCard) => (
                  <ArticleCard key={post.id} post={post} size="horizontal" />
                ))}
              </View>
            </View>
          </Section>
        )}

        <Section style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionKicker}>{activeCategory ? '◈ Filtered' : '— Latest'}</Text>
            <H2 style={s.sectionTitle}>{activeCategory ? categories.find((c: BlogCategory) => c.slug === activeCategory)?.title ?? 'Posts' : 'Latest stories'}</H2>
          </View>

          {filterLoading ? (
            <View style={s.grid3}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={s.gridItem3}>
                  <ArticleCardSkeleton size="secondary" />
                </View>
              ))}
            </View>
          ) : displayPosts.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>Nothing here yet</Text>
              <Text style={s.emptySub}>Check back soon for new stories.</Text>
            </View>
          ) : (
            <View style={s.grid3}>
              {displayPosts.map((post: BlogPostCard) => (
                <View key={post.id} style={s.gridItem3}>
                  <ArticleCard post={post} size="secondary" />
                </View>
              ))}
            </View>
          )}
        </Section>
      </Main>

      <View style={s.footer}>
        <Text style={s.footerText}>© {new Date().getFullYear()} DVNT. All rights reserved.</Text>
        <View style={s.footerLinks}>
          <A href="/blog" style={s.footerLink}><Span style={s.footerLinkText}>Magazine</Span></A>
          <A href="https://dvntapp.live" style={s.footerLink}><Span style={s.footerLinkText}>App</Span></A>
          <A href="/admin" style={s.footerLink}><Span style={s.footerLinkText}>Admin</Span></A>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  shell: { flex: 1, minHeight: '100vh' as any, backgroundColor: color.bg, position: 'relative' as any },
  wash: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, backgroundImage: 'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.22) 0%, rgba(124,58,237,0.08) 40%, rgba(2,3,10,0) 80%)' as any, pointerEvents: 'none' as any, zIndex: 0 },
  masthead: { position: 'sticky' as any, top: 0, zIndex: 50, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(2,3,10,0.82)', backdropFilter: 'saturate(180%) blur(20px)' as any },
  mastheadInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1280, width: '100%' as any, marginHorizontal: 'auto' as any, paddingHorizontal: space.xl, paddingVertical: 16 },
  mastheadLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 as any },
  mastheadLogoLink: { flexDirection: 'row', alignItems: 'baseline', gap: 8 as any, textDecorationLine: 'none' as any },
  mastheadLogo: { color: color.text, fontSize: 20, fontWeight: '900', fontFamily: SANS as any, letterSpacing: 3 },
  mastheadMag: { color: color.textFaint, fontSize: 11, fontFamily: MONO as any, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' as any },
  mastheadNav: { flexDirection: 'row', gap: space.lg as any, alignItems: 'center' },
  mastheadNavLink: { textDecorationLine: 'none' as any },
  mastheadNavText: { color: color.textFaint, fontSize: font.xs, fontWeight: '500' },
  main: { flex: 1, maxWidth: 1280, width: '100%' as any, marginHorizontal: 'auto' as any, paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.xxl as any, zIndex: 1, position: 'relative' as any },
  heroSection: { width: '100%' as any },
  categoryRailWrap: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: space.md, marginHorizontal: -space.xl, paddingHorizontal: space.xl },
  categoryRail: { flexShrink: 0 },
  categoryRailContent: { flexDirection: 'row', gap: space.sm as any, alignItems: 'center' },
  catChip: { paddingHorizontal: space.lg, paddingVertical: 7, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  catChipActive: { backgroundColor: 'rgba(255,91,252,0.15)', borderColor: 'rgba(255,91,252,0.4)' },
  catChipHover: { backgroundColor: 'rgba(255,255,255,0.05)' },
  catChipText: { color: color.textDim, fontSize: 12, fontFamily: MONO as any, fontWeight: '600', letterSpacing: 0.8 },
  catChipTextActive: { color: color.brand },
  section: { gap: space.xl as any },
  sectionHeader: { gap: 6 as any, marginBottom: space.md },
  sectionKicker: { color: color.cyan, fontSize: 10, fontFamily: MONO as any, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' as any },
  sectionTitle: { color: color.text, fontSize: 28, fontWeight: '800', fontFamily: SANS as any, letterSpacing: -0.5 },
  grid4: { flexDirection: 'row', flexWrap: 'wrap' as any, gap: space.lg as any },
  gridItem4: { flexBasis: '23%' as any, flexGrow: 1, minWidth: 220 },
  grid3: { flexDirection: 'row', flexWrap: 'wrap' as any, gap: space.lg as any },
  gridItem3: { flexBasis: '30%' as any, flexGrow: 1, minWidth: 280 },
  trendingLayout: { flexDirection: 'row', gap: space.xxl as any, flexWrap: 'wrap' as any },
  trendingLeft: { flex: 1, minWidth: 280, gap: 0 as any },
  trendingRight: { flex: 1, minWidth: 280 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl * 2, gap: space.md as any },
  emptyTitle: { color: color.textDim, fontSize: font.lg, fontWeight: '700', fontFamily: SANS as any },
  emptySub: { color: color.textFaint, fontSize: font.sm },
  footer: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingVertical: space.xl, paddingHorizontal: space.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as any, gap: space.md as any, maxWidth: 1280, width: '100%' as any, marginHorizontal: 'auto' as any, zIndex: 1 },
  footerText: { color: color.textFaint, fontSize: font.xs, fontFamily: MONO as any },
  footerLinks: { flexDirection: 'row', gap: space.lg as any },
  footerLink: { textDecorationLine: 'none' as any },
  footerLinkText: { color: color.textFaint, fontSize: font.xs },
})
