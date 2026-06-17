// src/app/(marketing)/blog/page.tsx — DVNT Magazine index (server component)
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  fetchPostsIndex, fetchFeaturedPost, fetchEditorsPicks,
  fetchTrending, fetchCategories, mediaUrl, formatByline, formatDateShort,
  type BlogPostCard, type BlogCategory,
} from '@/lib/blog-api'
import { BlogCategoryFilter } from './category-filter'

export const metadata: Metadata = {
  title: 'DVNT Magazine — Culture, Events & Editorial',
  description: 'The DVNT editorial platform. Premium nightlife culture, event guides, creator features, and more.',
  openGraph: { title: 'DVNT Magazine', description: 'Culture, events, and editorial from DVNT.' },
}

const SANS = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace'

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>
}) {
  const { category, page: pageStr } = await searchParams
  const page = parseInt(pageStr ?? '1', 10)

  const [featured, editorsPicks, trending, categories, posts] = await Promise.all([
    fetchFeaturedPost(),
    fetchEditorsPicks(4),
    fetchTrending(5),
    fetchCategories(),
    fetchPostsIndex({ page, limit: 12, category }),
  ])

  return (
    <div style={shell}>
      <div style={wash} aria-hidden="true" />

      {/* ── Masthead ── */}
      <div style={masthead}>
        <div style={mastheadInner}>
          <div>
            <span style={mastheadLogo}>DVNT</span>
            <span style={mastheadMag}> Magazine</span>
          </div>
        </div>
      </div>

      <main style={main}>

        {/* ── Featured hero ── */}
        {featured && !category && <FeaturedHero post={featured} />}

        {/* ── Category filter ── */}
        {categories.length > 0 && (
          <BlogCategoryFilter categories={categories} active={category} />
        )}

        {/* ── Editor's Picks ── */}
        {editorsPicks.length > 0 && !category && (
          <section style={section} aria-label="Editor's picks">
            <SectionHeader kicker="✦ Curated" title="Editor's Picks" />
            <div style={grid4}>
              {editorsPicks.map((p) => <SecondaryCard key={p.id} post={p} />)}
            </div>
          </section>
        )}

        {/* ── Trending ── */}
        {trending.length > 0 && !category && (
          <section style={section} aria-label="Trending">
            <SectionHeader kicker="↑ Trending" title="Right now" />
            <div style={trendingLayout}>
              <div style={{ flex: 1, minWidth: 280 }}>
                {trending.slice(0, 3).map((p, i) => <CompactCard key={p.id} post={p} index={i} />)}
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                {trending.slice(3).map((p) => <HorizontalCard key={p.id} post={p} />)}
              </div>
            </div>
          </section>
        )}

        {/* ── Posts grid ── */}
        <section style={section} aria-label={category ? `Posts in ${category}` : 'Latest stories'}>
          <SectionHeader
            kicker={category ? '◈ Filtered' : '— Latest'}
            title={category ? (categories.find((c) => c.slug === category)?.title ?? 'Posts') : 'Latest stories'}
          />
          {posts.docs.length === 0 ? (
            <div style={empty}>
              <p style={emptyTitle}>Nothing here yet.</p>
              <p style={emptySub}>Check back soon for new stories.</p>
            </div>
          ) : (
            <div style={grid3}>
              {posts.docs.map((p) => <SecondaryCard key={p.id} post={p} />)}
            </div>
          )}
          {posts.totalPages > 1 && (
            <Pagination page={page} totalPages={posts.totalPages} category={category} />
          )}
        </section>
      </main>

      <style>{CSS}</style>
    </div>
  )
}

// ─── Featured hero ────────────────────────────────────────────────────────

function FeaturedHero({ post }: { post: BlogPostCard }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : null
  const cat = post.categories?.[0]
  return (
    <section style={heroSection} aria-label="Featured story">
      <Link href={`/blog/${post.slug}`} style={heroLink} className="dvnt-hero-card">
        <div style={heroImgWrap}>
          {imgSrc
            ? <img src={imgSrc} alt={post.heroImage?.alt ?? post.title} style={heroImg} />
            : <div style={heroImgFallback} />}
          <div style={heroOverlay} aria-hidden="true" />
          <div style={heroGlow} aria-hidden="true" />
        </div>
        <div style={heroBody}>
          <div style={heroMeta}>
            {cat && <CategoryPill category={cat} />}
            {post.eyebrow && !cat && <span style={eyebrow}>{post.eyebrow}</span>}
            {(post.featured || post.editorsPick) && (
              <span style={editorialBadge}>{post.editorsPick ? "\u2736 Editor's Pick" : '\u2605 Featured'}</span>
            )}
          </div>
          <h2 style={heroTitle}>{post.title}</h2>
          {post.excerpt && <p style={heroDek}>{post.excerpt}</p>}
          <BylineRow post={post} />
        </div>
      </Link>
    </section>
  )
}

// ─── Secondary card ───────────────────────────────────────────────────────

function SecondaryCard({ post }: { post: BlogPostCard }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : null
  const cat = post.categories?.[0]
  return (
    <article style={secCard} className="dvnt-card">
      <Link href={`/blog/${post.slug}`} style={secImgLink}>
        <div style={secImgWrap}>
          {imgSrc
            ? <img src={imgSrc} alt={post.heroImage?.alt ?? post.title} style={secImg} />
            : <div style={secImgFallback} />}
          <div style={secOverlay} aria-hidden="true" />
        </div>
      </Link>
      <div style={secBody}>
        {cat && <CategoryPill category={cat} />}
        <Link href={`/blog/${post.slug}`} style={titleLink}>
          <h3 style={secTitle}>{post.title}</h3>
        </Link>
        {post.excerpt && <p style={secExcerpt}>{post.excerpt}</p>}
        <BylineRow post={post} compact />
      </div>
    </article>
  )
}

// ─── Compact card (numbered) ──────────────────────────────────────────────

function CompactCard({ post, index }: { post: BlogPostCard; index: number }) {
  const cat = post.categories?.[0]
  return (
    <article style={cmpCard}>
      <span style={cmpNum} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div style={cmpBody}>
        {cat && <CategoryPill category={cat} />}
        <Link href={`/blog/${post.slug}`} style={titleLink}>
          <h3 style={cmpTitle}>{post.title}</h3>
        </Link>
        {post.publishedAt && <time dateTime={post.publishedAt} style={metaText}>{formatDateShort(post.publishedAt)}</time>}
      </div>
    </article>
  )
}

// ─── Horizontal card ─────────────────────────────────────────────────────

function HorizontalCard({ post }: { post: BlogPostCard }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : null
  const cat = post.categories?.[0]
  return (
    <article style={hzCard} className="dvnt-hz-card">
      <Link href={`/blog/${post.slug}`} style={hzImgLink} aria-hidden="true" tabIndex={-1}>
        <div style={hzImgWrap}>
          {imgSrc
            ? <img src={imgSrc} alt={post.heroImage?.alt ?? post.title} style={hzImg} />
            : <div style={hzImgFallback} />}
        </div>
      </Link>
      <div style={hzBody}>
        {cat && <CategoryPill category={cat} />}
        <Link href={`/blog/${post.slug}`} style={titleLink}>
          <h3 style={hzTitle}>{post.title}</h3>
        </Link>
        <BylineRow post={post} compact />
      </div>
    </article>
  )
}

// ─── Byline row ──────────────────────────────────────────────────────────

function BylineRow({ post, compact }: { post: BlogPostCard; compact?: boolean }) {
  const authors = post.authors ?? []
  return (
    <div style={bylineRow}>
      {authors.length > 0 && (
        <div style={avatarStack}>
          {authors.slice(0, 3).map((a, i) => {
            const src = a.avatar ? mediaUrl(a.avatar, 'thumbnail') : null
            const initials = a.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
            return (
              <div key={a.id} style={{ ...avatarWrap, marginLeft: i > 0 ? -8 : 0 }}>
                {src
                  ? <img src={src} alt={a.name} style={avatarImg} />
                  : <div style={avatarFallback}><span style={avatarInitials}>{initials}</span></div>}
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {authors.length > 0 && (
          <span style={bylineName}>{formatByline(authors)}</span>
        )}
        <div style={bylineMeta}>
          {post.publishedAt && (
            <time dateTime={post.publishedAt} style={metaText}>{formatDateShort(post.publishedAt)}</time>
          )}
          {post.publishedAt && post.readTime && <span style={metaDot}>·</span>}
          {post.readTime && <span style={metaText}>{post.readTime} min read</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Category pill ────────────────────────────────────────────────────────

function CategoryPill({ category }: { category: BlogCategory }) {
  const accent = category.accentColor ?? '#FF5BFC'
  return (
    <Link
      href={`/blog?category=${category.slug}`}
      style={{
        display: 'inline-block', textDecoration: 'none',
        padding: '3px 10px', borderRadius: 999,
        border: `1px solid ${accent}44`, background: `${accent}18`,
        color: accent, fontSize: 10, fontFamily: MONO,
        fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
      }}
    >
      {category.title}
    </Link>
  )
}

// ─── Section header ───────────────────────────────────────────────────────

function SectionHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={sectionKicker}>{kicker}</p>
      <h2 style={sectionTitle}>{title}</h2>
    </div>
  )
}

// ─── Pagination ──────────────────────────────────────────────────────────

function Pagination({ page, totalPages, category }: { page: number; totalPages: number; category?: string }) {
  const base = `/blog${category ? `?category=${category}&` : '?'}`
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 48 }}>
      {page > 1 && (
        <Link href={`${base}page=${page - 1}`} style={pagerBtn}>← Previous</Link>
      )}
      <span style={pagerInfo}>Page {page} of {totalPages}</span>
      {page < totalPages && (
        <Link href={`${base}page=${page + 1}`} style={pagerBtn}>Next →</Link>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const GLASS = 'rgba(8,10,20,0.72)'
const BORDER = 'rgba(255,255,255,0.09)'

const shell: React.CSSProperties = {
  position: 'relative', minHeight: '100vh',
  background: 'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.22) 0%, rgba(124,58,237,0.08) 40%, rgba(2,3,10,0) 80%), #02030A',
  color: '#FAFAF9',
}
const wash: React.CSSProperties = {
  position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
  background: 'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.18) 0%, transparent 70%)',
}
const masthead: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 40,
  borderBottom: `1px solid ${BORDER}`,
  background: 'rgba(2,3,10,0.82)', backdropFilter: 'saturate(180%) blur(20px)',
  WebkitBackdropFilter: 'saturate(180%) blur(20px)',
}
const mastheadInner: React.CSSProperties = {
  maxWidth: 1536, margin: '0 auto', padding: '14px 24px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const mastheadLogo: React.CSSProperties = {
  color: '#FAFAF9', fontSize: 20, fontWeight: 900, fontFamily: SANS, letterSpacing: 3,
}
const mastheadMag: React.CSSProperties = {
  color: 'rgba(245,245,244,0.4)', fontSize: 11, fontFamily: MONO,
  fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase',
}
const main: React.CSSProperties = {
  position: 'relative', zIndex: 1,
  maxWidth: 1536, margin: '0 auto', padding: '40px 24px 120px',
  display: 'flex', flexDirection: 'column', gap: 64,
}

// Hero
const heroSection: React.CSSProperties = {}
const heroLink: React.CSSProperties = { display: 'block', textDecoration: 'none', borderRadius: 20, overflow: 'hidden', border: `1px solid ${BORDER}` }
const heroImgWrap: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: '21/9' }
const heroImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
const heroImgFallback: React.CSSProperties = { width: '100%', height: '100%', background: 'rgba(138,64,207,0.2)' }
const heroOverlay: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%',
  background: 'linear-gradient(to top, rgba(2,3,10,0.98) 0%, rgba(2,3,10,0.6) 40%, transparent 100%)',
}
const heroGlow: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, width: '50%', height: '50%', pointerEvents: 'none',
  background: 'radial-gradient(60% 50% at 80% 10%, rgba(138,64,207,0.28) 0%, transparent 80%)',
}
const heroBody: React.CSSProperties = {
  padding: '28px 32px 32px', background: GLASS,
  backdropFilter: 'saturate(160%) blur(18px)', WebkitBackdropFilter: 'saturate(160%) blur(18px)',
  display: 'flex', flexDirection: 'column', gap: 12,
}
const heroMeta: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const heroTitle: React.CSSProperties = {
  margin: 0, color: '#FAFAF9', fontFamily: SANS, fontSize: 'clamp(22px,3.5vw,38px)',
  fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.15,
}
const heroDek: React.CSSProperties = {
  margin: 0, color: 'rgba(245,245,244,0.78)', fontFamily: SANS,
  fontSize: 'clamp(15px,1.4vw,19px)', lineHeight: '1.65', maxWidth: 620,
}
const eyebrow: React.CSSProperties = { color: '#3FDCFF', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }
const editorialBadge: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(255,91,252,0.35)',
  background: 'rgba(255,91,252,0.12)', color: '#FF5BFC',
  fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5,
}

// Secondary card
const secCard: React.CSSProperties = {
  borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}`,
  background: GLASS, backdropFilter: 'saturate(160%) blur(18px)',
  WebkitBackdropFilter: 'saturate(160%) blur(18px)', display: 'flex', flexDirection: 'column',
}
const secImgLink: React.CSSProperties = { textDecoration: 'none', display: 'block' }
const secImgWrap: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: '3/2', overflow: 'hidden' }
const secImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .4s ease' }
const secImgFallback: React.CSSProperties = { width: '100%', height: '100%', background: 'rgba(138,64,207,0.15)' }
const secOverlay: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%',
  background: 'linear-gradient(to top, rgba(8,10,20,0.7) 0%, transparent 100%)',
}
const secBody: React.CSSProperties = { padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }
const titleLink: React.CSSProperties = { textDecoration: 'none', display: 'block' }
const secTitle: React.CSSProperties = {
  margin: 0, color: '#FAFAF9', fontFamily: SANS,
  fontSize: 17, fontWeight: 700, lineHeight: '1.4', letterSpacing: '-0.02em',
}
const secExcerpt: React.CSSProperties = {
  margin: 0, color: 'rgba(245,245,244,0.65)', fontSize: 13, lineHeight: '1.6',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
}

// Compact card
const cmpCard: React.CSSProperties = {
  display: 'flex', gap: 14, paddingBottom: 16, marginBottom: 16,
  borderBottom: '1px solid rgba(255,255,255,0.07)', alignItems: 'flex-start',
}
const cmpNum: React.CSSProperties = {
  color: 'rgba(255,91,252,0.4)', fontSize: 24, fontWeight: 900,
  fontFamily: MONO, lineHeight: '26px', width: 32, flexShrink: 0,
}
const cmpBody: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }
const cmpTitle: React.CSSProperties = {
  margin: 0, color: '#FAFAF9', fontFamily: SANS,
  fontSize: 15, fontWeight: 700, lineHeight: '1.35', letterSpacing: '-0.01em',
}

// Horizontal card
const hzCard: React.CSSProperties = {
  display: 'flex', gap: 14, paddingBottom: 16, marginBottom: 16,
  borderBottom: '1px solid rgba(255,255,255,0.07)', alignItems: 'flex-start',
}
const hzImgLink: React.CSSProperties = { textDecoration: 'none', flexShrink: 0 }
const hzImgWrap: React.CSSProperties = { width: 88, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }
const hzImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
const hzImgFallback: React.CSSProperties = { width: '100%', height: '100%', background: 'rgba(138,64,207,0.15)' }
const hzBody: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }
const hzTitle: React.CSSProperties = {
  margin: 0, color: '#FAFAF9', fontFamily: SANS,
  fontSize: 14, fontWeight: 700, lineHeight: '1.35', letterSpacing: '-0.01em',
}

// Byline
const bylineRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 'auto' }
const avatarStack: React.CSSProperties = { display: 'flex', alignItems: 'center' }
const avatarWrap: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 12, overflow: 'hidden',
  border: '1.5px solid rgba(255,255,255,0.14)', flexShrink: 0,
}
const avatarImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' }
const avatarFallback: React.CSSProperties = {
  width: '100%', height: '100%', background: 'rgba(138,64,207,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const avatarInitials: React.CSSProperties = { color: '#fff', fontSize: 9, fontWeight: 700 }
const bylineName: React.CSSProperties = { color: 'rgba(245,245,244,0.72)', fontSize: 12, fontFamily: SANS }
const bylineMeta: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }
const metaText: React.CSSProperties = { color: 'rgba(245,245,244,0.45)', fontSize: 11, fontFamily: MONO }
const metaDot: React.CSSProperties = { color: 'rgba(245,245,244,0.3)', fontSize: 11 }

// Grids + sections
const section: React.CSSProperties = {}
const sectionKicker: React.CSSProperties = {
  margin: '0 0 4px', color: '#3FDCFF', fontSize: 10, fontFamily: MONO,
  fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
}
const sectionTitle: React.CSSProperties = {
  margin: 0, color: '#FAFAF9', fontFamily: SANS,
  fontSize: 'clamp(20px,2.5vw,28px)', fontWeight: 800, letterSpacing: '-0.03em',
}
const grid4: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 16,
}
const grid3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
}
const trendingLayout: React.CSSProperties = { display: 'flex', gap: 40, flexWrap: 'wrap' }

// Empty state
const empty: React.CSSProperties = { textAlign: 'center', padding: '80px 0' }
const emptyTitle: React.CSSProperties = { margin: '0 0 8px', color: 'rgba(245,245,244,0.6)', fontFamily: SANS, fontSize: 20, fontWeight: 700 }
const emptySub: React.CSSProperties = { margin: 0, color: 'rgba(245,245,244,0.35)', fontSize: 14 }

// Pagination
const pagerBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
  background: GLASS, color: '#FAFAF9', textDecoration: 'none',
  fontSize: 13, fontFamily: MONO, fontWeight: 600, letterSpacing: 0.5,
}
const pagerInfo: React.CSSProperties = {
  padding: '8px 0', color: 'rgba(245,245,244,0.4)', fontSize: 13, fontFamily: MONO,
}

const CSS = `
.dvnt-hero-card { transition: box-shadow .3s ease; }
.dvnt-hero-card:hover { box-shadow: 0 0 0 1px rgba(255,91,252,0.3), 0 32px 80px rgba(0,0,0,0.6); }
.dvnt-hero-card:hover img { transform: scale(1.02); transition: transform .6s cubic-bezier(0.22,1,0.36,1); }
.dvnt-card { transition: transform .3s cubic-bezier(0.22,1,0.36,1), box-shadow .3s ease, border-color .3s ease; }
.dvnt-card:hover { transform: translateY(-4px); box-shadow: 0 24px 60px rgba(0,0,0,0.45); border-color: rgba(255,91,252,0.25); }
.dvnt-card:hover img { transform: scale(1.04); transition: transform .5s cubic-bezier(0.22,1,0.36,1); }
.dvnt-hz-card { transition: background .2s ease; }
.dvnt-hz-card:hover { background: rgba(255,255,255,0.04); border-radius: 12px; }
@media (max-width: 640px) {
  .dvnt-hero-card img { aspect-ratio: 4/3; }
}
`
