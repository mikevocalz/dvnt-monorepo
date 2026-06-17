// src/app/posts/page.tsx — DVNT Magazine editorial index. ISR 60s.
// Award-level layout: cinematic full-bleed hero → asymmetric secondary row →
// category rail → editors picks → trending → grid → newsletter CTA.
import Link from 'next/link'
import Image from 'next/image'
import {
  getPublishedPosts, getFeaturedPost, getEditorsPicks, getTrending, getCategories,
  mediaUrl, formatByline, formatDateShort,
  type Post, type PostAuthor, type PostCategory,
} from '@/lib/posts'
import { NewsletterCTA } from './components/NewsletterCTA'
import { MagneticCards } from './components/MagneticCards'

export const revalidate = 60

const DISPLAY = '"Republica-Minor", system-ui, sans-serif'
const SANS = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const metadata = {
  title: 'DVNT Magazine — Culture, Events & Editorial',
  description: 'Premium nightlife culture, event guides, creator features, and more from DVNT.',
  alternates: { canonical: 'https://blog.dvntapp.live' },
  openGraph: {
    title: 'DVNT Magazine',
    description: 'Culture, community, and pleasure — unapologetically Black, queer, and loud.',
    images: [{ url: 'https://dvntapp.live/og-blog.png' }],
  },
}

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const { category } = await searchParams
  const [featured, editorsPicks, trending, categories, posts] = await Promise.all([
    getFeaturedPost(),
    getEditorsPicks(4),
    getTrending(5),
    getCategories(),
    getPublishedPosts(16, category),
  ])

  // The 2nd and 3rd posts fill the asymmetric secondary row
  const [, second, third, ...rest] = posts

  return (
    <div style={shell as any} className="dvnt-blog">
      <div style={wash as any} />
      {/* Pointer-follow tilt for index cards (fine pointer + motion-allowed only) */}
      <MagneticCards />

      {/* ── Cinematic full-bleed hero (no container max-width) ── */}
      {featured && !category && <CinematicHero post={featured} />}

      <main style={main as any}>

        {/* ── Page header (shown when filtering or no featured) ── */}
        {(!featured || category) && (
          <header style={pageHead}>
            <h2 style={indexTitle}>Blog</h2>
            <p style={indexIntro}>
              Culture, community, and pleasure. By us, for us — unapologetically Black, queer, and loud.
            </p>
          </header>
        )}

        {/* ── Asymmetric secondary row: 2-up wide + 1 tall ── */}
        {!category && second && (
          <section aria-label="Latest stories">
            <SectionLabel kicker="" title="— Latest Stories" />
            <div style={asym as any}>
              <div style={asymLeft as any}>
                {second && <WideCard post={second} />}
                {third && <WideCard post={third} />}
              </div>
              {posts[3] && (
                <div style={asymRight as any}>
                  <TallCard post={posts[3]} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Category filter ── */}
        {categories.length > 0 && (
          <nav style={catRail as any} aria-label="Filter by category">
            <Link href="/posts" style={catChip(!category) as any}>All</Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/posts?category=${cat.slug}`}
                style={catChipAccent(category === cat.slug, cat.accentColor) as any}
              >
                {cat.title}
              </Link>
            ))}
          </nav>
        )}

        {/* ── Editors picks ── */}
        {editorsPicks.length > 0 && !category && (
          <section style={sectionWrap as any} aria-label="Editor's picks">
            <SectionLabel kicker="✦ Curated" title="Editor's Picks" />
            <ul style={grid4 as any}>
              {editorsPicks.map((p, i) => (
                <li key={p.id} style={{ listStyle: 'none' } as any} className={`dvnt-reveal dvnt-reveal-${i}`}>
                  <SecondaryCard post={p} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Trending ── */}
        {trending.length > 0 && !category && (
          <section style={sectionWrap as any} aria-label="Trending now">
            <SectionLabel kicker="↑ Trending" title="Right now" />
            <div style={twoCol as any}>
              <div style={{ flex: '1 1 260px' } as any}>
                {trending.slice(0, 3).map((p, i) => <CompactCard key={p.id} post={p} index={i} />)}
              </div>
              <div style={{ flex: '1 1 260px' } as any}>
                {trending.slice(3).map((p) => <HorizontalCard key={p.id} post={p} />)}
              </div>
            </div>
          </section>
        )}

        {/* ── More / filtered grid (only when there are extra posts to show) ── */}
        {(category ? posts.length > 0 : rest.length > 0) ? (
          <section style={sectionWrap as any} aria-label={category ? `Posts: ${category}` : 'More stories'}>
            <SectionLabel
              kicker={category ? '◈ Filtered' : ''}
              title={category
                ? (categories.find((c) => c.slug === category)?.title ?? 'Posts')
                : '— More Stories'}
            />
            <ul style={grid3 as any}>
              {(category ? posts : rest).map((p, i) => (
                <li key={p.id} style={{ listStyle: 'none' } as any} className={`dvnt-reveal dvnt-reveal-${Math.min(i, 5)}`}>
                  <SecondaryCard post={p} />
                </li>
              ))}
            </ul>
          </section>
        ) : posts.length === 0 ? (
          <section style={sectionWrap as any} aria-label="No posts">
            <SectionLabel kicker="" title="— Latest Stories" />
            <EmptyState />
          </section>
        ) : null}

        {/* ── Newsletter / App CTA ── */}
        {!category && <NewsletterCTA />}

      </main>
      <style>{CSS}</style>
    </div>
  )
}

// ─── Cinematic full-bleed hero ─────────────────────────────────────────────
// Spans full viewport width, text overlaid bottom-left on the image.

function CinematicHero({ post }: { post: Post }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  return (
    <section style={cinemaWrap as any} aria-label="Featured story">
      <Link href={`/posts/${post.slug}`} style={{ display: 'block', textDecoration: 'none', height: '100%' }} className="dvnt-cinema">
        {imgSrc ? (
          <div style={cinemaImgWrap as any}>
            <Image
              src={imgSrc}
              alt={post.heroImage?.alt ?? post.title}
              fill
              sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: 'center top' }}
              priority
            />
            <div style={cinemaOverlay as any} />
          </div>
        ) : (
          <div style={{ ...cinemaImgWrap, background: 'linear-gradient(135deg,#0e1318,#07090c)' } as any} />
        )}
        <div className="dvnt-cinema-body" style={cinemaBody as any}>
          <div style={cinemaTopBar as any}>
            <span style={cinemaSiteName as any}>DVNT Magazine</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
              {cat && <CatPill category={cat} size="sm" />}
              {post.editorsPick && <span style={edBadge as any}>✦ Editor&apos;s Pick</span>}
              {post.trending && <span style={trendBadge as any}>↑ Trending</span>}
            </div>
          </div>
          <div style={cinemaContent as any}>
            <h1 style={cinemaTitle as any}>{post.title}</h1>
            {/* Signature: animated brand-gradient hairline under the title */}
            <div className="dvnt-rule" style={{ maxWidth: 200, margin: '2px 0 2px' }} aria-hidden="true" />
            {post.excerpt && <p style={cinemaDek as any}>{post.excerpt}</p>}
            <BylineRow post={post} light />
          </div>
          <span style={cinemaReadMore as any}>Read story →</span>
        </div>
      </Link>
    </section>
  )
}

// ─── Wide card (horizontal, 16:9) ─────────────────────────────────────────

function WideCard({ post }: { post: Post }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  return (
    <article style={wideCard as any} className="dvnt-card">
      <Link href={`/posts/${post.slug}`} style={{ display: 'flex', flexDirection: 'row', textDecoration: 'none', height: '100%' }}>
        {imgSrc && (
          <div style={wideImgWrap as any}>
            <Image src={imgSrc} alt={post.heroImage?.alt ?? post.title} fill sizes="(max-width: 700px) 90vw, 360px" style={{ objectFit: 'cover' }} />
          </div>
        )}
        <div style={wideBody as any}>
          {cat && <CatPill category={cat} />}
          <h2 style={wideTitle as any}>{post.title}</h2>
          {post.excerpt && <p style={wideExcerpt as any}>{post.excerpt}</p>}
          <BylineRow post={post} compact />
        </div>
      </Link>
    </article>
  )
}

// ─── Tall card (vertical, portrait) ───────────────────────────────────────

function TallCard({ post }: { post: Post }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  return (
    <article style={tallCard as any} className="dvnt-card">
      <Link href={`/posts/${post.slug}`} style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', height: '100%' }}>
        {imgSrc && (
          <div style={tallImgWrap as any}>
            <Image src={imgSrc} alt={post.heroImage?.alt ?? post.title} fill sizes="(max-width: 700px) 90vw, 360px" style={{ objectFit: 'cover' }} />
            <div style={tallOverlay as any} />
          </div>
        )}
        <div style={tallBody as any}>
          {cat && <CatPill category={cat} />}
          <h2 style={tallTitle as any}>{post.title}</h2>
          {post.excerpt && <p style={tallExcerpt as any}>{post.excerpt}</p>}
          <BylineRow post={post} compact />
        </div>
      </Link>
    </article>
  )
}

// ─── Secondary card ───────────────────────────────────────────────────────

function SecondaryCard({ post }: { post: Post }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  return (
    <article style={secCard as any} className="dvnt-card">
      <Link href={`/posts/${post.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
        {imgSrc && (
          <div style={secImgWrap as any}>
            <Image src={imgSrc} alt={post.heroImage?.alt ?? post.title} fill sizes="(max-width: 700px) 90vw, 360px" style={{ objectFit: 'cover' }} />
            <div style={secOverlay as any} />
          </div>
        )}
      </Link>
      <div style={secBody as any}>
        {cat && <CatPill category={cat} />}
        <Link href={`/posts/${post.slug}`} style={{ textDecoration: 'none' }}>
          <h2 style={secTitle as any}>{post.title}</h2>
        </Link>
        {post.excerpt && <p style={secExcerpt as any}>{post.excerpt}</p>}
        <BylineRow post={post} compact />
      </div>
    </article>
  )
}

// ─── Compact card (numbered trending) ────────────────────────────────────

function CompactCard({ post, index }: { post: Post; index: number }) {
  const cat = post.categories?.[0]
  return (
    <div style={cmpCard as any}>
      <span style={cmpNum as any} aria-hidden={true}>{String(index + 1).padStart(2, '0')}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 } as any}>
        {cat && <CatPill category={cat} />}
        <Link href={`/posts/${post.slug}`} style={{ textDecoration: 'none' }}>
          <h2 style={cmpTitle as any}>{post.title}</h2>
        </Link>
        {post.publishedAt && <time style={metaText as any}>{formatDateShort(post.publishedAt)}</time>}
      </div>
    </div>
  )
}

// ─── Horizontal card ─────────────────────────────────────────────────────

function HorizontalCard({ post }: { post: Post }) {
  const imgSrc = post.heroImage ? mediaUrl(post.heroImage, 'card') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  return (
    <div style={hzCard as any} className="dvnt-hz">
      {imgSrc && (
        <Link href={`/posts/${post.slug}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
          <div style={hzImgWrap as any}>
            <Image src={imgSrc} alt={post.heroImage?.alt ?? post.title} fill sizes="(max-width: 700px) 90vw, 360px" style={{ objectFit: 'cover' }} />
          </div>
        </Link>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 } as any}>
        {cat && <CatPill category={cat} />}
        <Link href={`/posts/${post.slug}`} style={{ textDecoration: 'none' }}>
          <h2 style={cmpTitle as any}>{post.title}</h2>
        </Link>
        <BylineRow post={post} compact />
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={emptyWrap as any} role="status" aria-label="No posts yet">
      <span style={emptyIcon as any}>✦</span>
      <p style={emptyMsg as any}>Nothing here yet — the night is still being written.</p>
    </div>
  )
}

// ─── Byline row ──────────────────────────────────────────────────────────

function BylineRow({ post, compact, light }: { post: Post; compact?: boolean; light?: boolean }) {
  const authors = post.authors ?? []
  const textColor = light ? 'rgba(255,255,255,0.75)' : 'rgba(245,245,244,0.65)'
  const dimColor = light ? 'rgba(255,255,255,0.5)' : 'rgba(245,245,244,0.4)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 } as any}>
      {authors.length > 0 && (
        <div style={avatarStack as any}>
          {authors.slice(0, 3).map((a, i) => <AuthorAvatar key={a.id} author={a} index={i} />)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 } as any}>
        {authors.length > 0 && (
          <span style={{ color: textColor, fontSize: 11, fontFamily: SANS } as any}>{formatByline(authors)}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 } as any}>
          {post.publishedAt && <time style={{ color: dimColor, fontSize: 11, fontFamily: MONO } as any}>{formatDateShort(post.publishedAt)}</time>}
          {post.publishedAt && post.readTime && <span style={{ color: dimColor, fontSize: 11 } as any}>·</span>}
          {post.readTime && <span style={{ color: dimColor, fontSize: 11, fontFamily: MONO } as any}>{post.readTime} min</span>}
        </div>
      </div>
    </div>
  )
}

function AuthorAvatar({ author, index }: { author: PostAuthor; index: number }) {
  const src = author.avatar ? mediaUrl(author.avatar, 'thumbnail') : null
  const initials = author.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ width: 24, height: 24, borderRadius: 7, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.14)', flexShrink: 0, marginLeft: index > 0 ? -8 : 0 } as any}>
      {src
        ? <Image src={src} alt={author.name} width={24} height={24} style={{ objectFit: 'cover', borderRadius: 7 }} />
        : <div style={{ width: '100%', height: '100%', background: 'rgba(135,78,159,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as any}>
            <span style={{ color: '#fff', fontSize: 9, fontWeight: '700' } as any}>{initials}</span>
          </div>}
    </div>
  )
}

// ─── Category pill ────────────────────────────────────────────────────────

function CatPill({ category, size = 'md' }: { category: PostCategory; size?: 'sm' | 'md' }) {
  const accent = category.accentColor ?? '#379ed8'
  return (
    <Link href={`/posts?category=${category.slug}`} style={{
      display: 'inline-block', alignSelf: 'flex-start', width: 'fit-content', textDecoration: 'none',
      padding: size === 'sm' ? '3px 9px' : '3px 10px', borderRadius: 7,
      // `sm` lives over the hero image → dark glass chip + solid accent edge so
      // it stays legible; `md` sits on dark cards and keeps the soft tint.
      border: `1px solid ${size === 'sm' ? accent : `${accent}44`}`,
      background: size === 'sm' ? 'rgba(7,9,12,0.55)' : `${accent}18`,
      backdropFilter: size === 'sm' ? 'saturate(140%) blur(8px)' : undefined,
      color: accent, fontSize: size === 'sm' ? 9.5 : 10, fontFamily: MONO,
      fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
    } as any}>
      {category.title}
    </Link>
  )
}

function SectionLabel({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 } as any}>
      <span style={secKicker as any}>{kicker}</span>
      <h2 style={secHeading}>{title}</h2>
      {/* Animated brand-gradient divider replaces the static hairline */}
      <div className="dvnt-rule" style={{ marginTop: 14 }} aria-hidden="true" />
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const shell = { minHeight: '100vh', backgroundColor: '#07090c', color: '#FAFAF9' }
const wash = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none',
  backgroundImage: 'radial-gradient(70% 42% at 50% 0%, rgba(135,78,159,0.22) 0%, rgba(116,63,146,0.08) 40%, rgba(7,9,12,0) 75%)',
}
const main = { maxWidth: 1200, margin: '0 auto', width: '100%', padding: 'clamp(28px,5vw,48px) clamp(16px,4vw,24px) 128px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 'clamp(44px,7vw,72px)' }

// Cinema hero (full viewport)
const cinemaWrap: React.CSSProperties = { position: 'relative', width: '100%', height: 'clamp(440px,72vh,600px)', overflow: 'hidden', cursor: 'pointer' }
// `viewTransitionName` shared with the post hero → cross-fade morph on
// supported (MPA / back-forward) navigations; ignored everywhere else.
const cinemaImgWrap = { position: 'absolute', inset: 0, viewTransitionName: 'post-hero' }
const cinemaOverlay: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'linear-gradient(to right, rgba(7,9,12,0.92) 0%, rgba(7,9,12,0.55) 50%, rgba(7,9,12,0.2) 100%), linear-gradient(to top, rgba(7,9,12,0.8) 0%, transparent 60%)',
}
const cinemaBody: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 'clamp(84px,11vw,104px) clamp(20px,5vw,56px) clamp(28px,5vw,44px)',
}
const cinemaTopBar: React.CSSProperties = { marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }
const cinemaSiteName: React.CSSProperties = { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }
const cinemaContent: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }
const cinemaTitle: React.CSSProperties = { margin: 0, color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 'clamp(30px,6.2vw,52px)', fontWeight: 900, lineHeight: 1.04, letterSpacing: '0.03em', textTransform: 'uppercase', wordSpacing: '0.04em' }
const cinemaDek: React.CSSProperties = { margin: 0, color: 'rgba(255,255,255,0.72)', fontSize: 'clamp(15px,2.2vw,18px)', lineHeight: '1.6', maxWidth: 560 }
const cinemaReadMore: React.CSSProperties = { alignSelf: 'flex-start', color: '#379ed8', fontSize: 12, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5 }

// Asymmetric secondary row
const asym: React.CSSProperties = { display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }
const asymLeft: React.CSSProperties = { flex: '2 1 360px', display: 'flex', flexDirection: 'column', gap: 16 }
const asymRight: React.CSSProperties = { flex: '1 1 260px', minWidth: 220 }

// Wide card
const wideCard: React.CSSProperties = { borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)', flex: 1, display: 'flex' }
const wideImgWrap: React.CSSProperties = { position: 'relative', width: 'clamp(116px,34vw,170px)', flexShrink: 0, overflow: 'hidden' }
const wideBody: React.CSSProperties = { flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }
const wideTitle: React.CSSProperties = { margin: 0, color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 15, fontWeight: 800, lineHeight: '1.2', letterSpacing: '0.05em', textTransform: 'uppercase' }
const wideExcerpt: React.CSSProperties = { margin: 0, color: 'rgba(245,245,244,0.58)', fontSize: 13, lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }

// Tall card
const tallCard: React.CSSProperties = { borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)', height: '100%', display: 'flex', flexDirection: 'column' }
const tallImgWrap: React.CSSProperties = { position: 'relative', flex: 1, minHeight: 200, overflow: 'hidden' }
const tallOverlay: React.CSSProperties = { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%', background: 'linear-gradient(to top, rgba(14,19,24,0.8) 0%, transparent 100%)' }
const tallBody: React.CSSProperties = { padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }
const tallTitle: React.CSSProperties = { margin: 0, color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, lineHeight: '1.2', letterSpacing: '0.05em', textTransform: 'uppercase' }
const tallExcerpt: React.CSSProperties = { margin: 0, color: 'rgba(245,245,244,0.58)', fontSize: 13, lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }

// Category rail
const catRail = { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: '0', margin: '-24px 0' }
const catChip = (active: boolean) => ({
  padding: '7px 18px', borderRadius: 7, textDecoration: 'none',
  border: `1px solid ${active ? 'rgba(55,158,216,0.5)' : 'rgba(255,255,255,0.10)'}`,
  background: active ? 'rgba(55,158,216,0.14)' : 'rgba(255,255,255,0.03)',
  color: active ? '#379ed8' : 'rgba(245,245,244,0.55)',
  fontSize: 12, fontFamily: MONO, fontWeight: 600, letterSpacing: 1,
  transition: 'all .2s ease',
})
const catChipAccent = (active: boolean, accent = '#379ed8') => ({
  padding: '7px 18px', borderRadius: 7, textDecoration: 'none',
  border: `1px solid ${active ? `${accent}55` : 'rgba(255,255,255,0.10)'}`,
  background: active ? `${accent}1a` : 'rgba(255,255,255,0.03)',
  color: active ? accent : 'rgba(245,245,244,0.55)',
  fontSize: 12, fontFamily: MONO, fontWeight: 600, letterSpacing: 1,
  transition: 'all .2s ease',
})

// Section label
const sectionWrap = {}
const secKicker = { display: 'block', color: '#b07ec9', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 6 }
const secHeading: React.CSSProperties = { margin: 0, padding: 0, border: 'none', outline: 'none', color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 24, fontWeight: 400, letterSpacing: '0.04em', textTransform: 'uppercase' }
const grid4 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 16, padding: 0, margin: 0, listStyle: 'none' }
const grid3 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 16, padding: 0, margin: 0, listStyle: 'none' }
const twoCol = { display: 'flex', gap: 48, flexWrap: 'wrap' }

// Page header (fallback when no featured)
const pageHead: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 100, border: 'none', outline: 'none' }
const indexTitle: React.CSSProperties = { margin: 0, padding: 0, border: 'none', outline: 'none', fontFamily: DISPLAY, fontSize: 40, lineHeight: 1, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#FAFAF9' }
const indexIntro = { margin: 0, maxWidth: 520, color: 'rgba(245,245,244,0.62)', fontSize: 17, lineHeight: '1.7', fontFamily: SANS }

// Secondary card
const secCard = { borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', backgroundColor: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)', display: 'flex', flexDirection: 'column', height: '100%' }
const secImgWrap = { position: 'relative', width: '100%', aspectRatio: '3/2', overflow: 'hidden' }
const secOverlay = { position: 'absolute', left: 0, right: 0, bottom: 0, height: '35%', background: 'linear-gradient(to top, rgba(14,19,24,0.6) 0%, transparent 100%)' }
const secBody = { padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }
const secTitle = { margin: 0, color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 15, fontWeight: 800, lineHeight: '1.2', letterSpacing: '0.05em', textTransform: 'uppercase' }
const secExcerpt = { margin: 0, color: 'rgba(245,245,244,0.6)', fontSize: 13, lineHeight: '1.55', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }

// Compact / horizontal
const cmpCard = { display: 'flex', gap: 14, paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'flex-start' }
const cmpNum = { color: 'rgba(55,158,216,0.35)', fontSize: 24, fontWeight: 900, fontFamily: MONO, lineHeight: '24px', width: 32, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }
const cmpTitle = { margin: 0, color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, lineHeight: '1.25', letterSpacing: '0.05em', textTransform: 'uppercase' }
const hzCard = { display: 'flex', gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'flex-start' }
const hzImgWrap = { width: 80, height: 60, borderRadius: 8, overflow: 'hidden', position: 'relative', flexShrink: 0 }

// Badges
// Hero-overlay badges: dark glass chip + brightened accent text so they read
// over the cover image (was a faint tint that washed out).
const edBadge = { padding: '3px 10px', borderRadius: 7, border: '1px solid rgba(55,158,216,0.8)', background: 'rgba(7,9,12,0.55)', backdropFilter: 'saturate(140%) blur(8px)', color: '#7cc3ea', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5 }
const trendBadge = { padding: '3px 10px', borderRadius: 7, border: '1px solid rgba(176,126,201,0.8)', background: 'rgba(7,9,12,0.55)', backdropFilter: 'saturate(140%) blur(8px)', color: '#c9a6dd', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5 }

// Byline
const avatarStack = { display: 'flex', alignItems: 'center' }
const metaText = { color: 'rgba(245,245,244,0.4)', fontSize: 11, fontFamily: MONO }

// Empty state
const emptyWrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: 16 }
const emptyIcon = { fontSize: 32, color: 'rgba(55,158,216,0.25)' }
const emptyMsg = { margin: 0, color: 'rgba(245,245,244,0.3)', fontSize: 15, fontFamily: SANS, textAlign: 'center', maxWidth: 320 }

const CSS = `
/* Cinema hero */
.dvnt-cinema{display:block}
.dvnt-cinema img{transition:transform 6s cubic-bezier(0.25,0.46,0.45,0.94)}
.dvnt-cinema:hover img{transform:scale(1.04)}

/* Cards */
.dvnt-card{transition:transform .35s cubic-bezier(0.22,1,0.36,1),box-shadow .35s ease,border-color .35s ease}
.dvnt-card:hover{transform:translateY(-5px)!important;box-shadow:0 24px 60px rgba(0,0,0,0.55),0 0 0 1px rgba(55,158,216,0.18)!important;border-color:rgba(55,158,216,0.2)!important}
.dvnt-hz{transition:background .2s ease;border-radius:10px}
.dvnt-hz:hover{background:rgba(255,255,255,0.05)}

/* Staggered reveals */
.dvnt-reveal{opacity:0;transform:translateY(20px);animation:dvntRise .7s cubic-bezier(0.22,1,0.36,1) forwards}
.dvnt-reveal-0{animation-delay:0s}
.dvnt-reveal-1{animation-delay:.07s}
.dvnt-reveal-2{animation-delay:.14s}
.dvnt-reveal-3{animation-delay:.21s}
.dvnt-reveal-4{animation-delay:.28s}
.dvnt-reveal-5{animation-delay:.35s}
@keyframes dvntRise{to{opacity:1;transform:none}}

/* Category rail hover */
a[style*="borderRadius: 7"]:hover{opacity:.85}

/* ── Responsive ── */
@media(max-width:760px){
  /* Stack the asymmetric "Latest stories" row */
  section[aria-label="Latest stories"]{flex-direction:column}
  /* Wide cards: image on top, body below — no thin side strip on phones */
  section[aria-label="Latest stories"] .dvnt-card > a{flex-direction:column!important}
  section[aria-label="Latest stories"] .dvnt-card > a > div:first-child{width:100%!important;aspect-ratio:16/9}
  /* Featured hero: the fixed site header floats over it; on phones (esp. with a
     notch) the header + safe-area inset crowded the hero's top row. Push the
     hero content below the header and reserve safe-area space so nothing overlaps. */
  .dvnt-cinema-body{padding-top:calc(96px + env(safe-area-inset-top,0px))!important}
  .dvnt-cinema-body > div:first-child{margin-top:0!important}
}

@media(prefers-reduced-motion:reduce){
  .dvnt-reveal{animation:none;opacity:1;transform:none}
  .dvnt-cinema img{transition:none}
  .dvnt-card{transition:none}
}`
