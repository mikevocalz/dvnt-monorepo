// src/app/posts/[slug]/page.tsx — DVNT article detail.
// NYT-style byline with contributors, author footer cards, rich prose.
import { notFound } from 'next/navigation'
import { draftMode } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import {
  getAllSlugs, getPostBySlug, getLatestPosts,
  mediaUrl, formatByline, formatDate, formatDateShort,
  type Post, type PostAuthor,
} from '@/lib/posts'
import { getCommentsForPost, buildTree } from '@/lib/comments'
import { RichText } from '@/components/RichText'
import { Comments } from '@/components/Comments'
import { ArticleProgress } from '../components/ArticleProgress'
import { ArticleStickyTools, type TocItem } from '../components/ArticleStickyTools'
import { NewsletterCTA } from '../components/NewsletterCTA'
import { ScrollReveal } from '../components/ScrollReveal'

export const revalidate = 60
export const dynamicParams = true

const DISPLAY = '"Republica-Minor", system-ui, sans-serif'
const SANS = 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export async function generateStaticParams() {
  return (await getAllSlugs()).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return {}
  const title = post.seo?.title ?? post.meta?.title ?? post.title
  const description = post.seo?.description ?? post.meta?.description ?? post.excerpt
  const image = post.seo?.ogImage ? mediaUrl(post.seo.ogImage, 'og')
    : post.meta?.image?.url ?? post.heroImage ? mediaUrl(post.heroImage!, 'og') : post.coverImage?.url
  const url = `https://blog.dvntapp.live/posts/${post.slug}`
  return {
    title,
    description,
    alternates: { canonical: post.seo?.canonicalUrl ?? url },
    openGraph: { title, description, url, type: 'article', images: image ? [{ url: image }] : undefined, publishedTime: post.publishedAt },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : undefined },
  }
}

// Extract h2/h3 headings from Payload Lexical content for the sticky TOC
function extractToc(content: unknown): TocItem[] {
  if (!content || typeof content !== 'object') return []
  const root = (content as any).root
  if (!root?.children) return []
  const items: TocItem[] = []
  for (const node of root.children) {
    if (node.type === 'heading' && (node.tag === 'h2' || node.tag === 'h3')) {
      const text = node.children?.map((c: any) => c.text ?? '').join('') ?? ''
      if (!text.trim()) continue
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      items.push({ id, text, level: node.tag === 'h2' ? 2 : 3 })
    }
  }
  return items
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { isEnabled: isDraft } = await draftMode()
  const [post, latest] = await Promise.all([
    getPostBySlug(slug, isDraft),
    getLatestPosts(3, slug),
  ])
  if (!post) notFound()

  const comments = buildTree(await getCommentsForPost(post.id))
  const heroSrc = post.heroImage ? mediaUrl(post.heroImage, 'full') : (post.coverImage?.url ?? null)
  const cat = post.categories?.[0]
  const toc = extractToc(post.content)
  const articleUrl = `https://blog.dvntapp.live/posts/${post.slug}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: post.authors?.map((a) => ({ '@type': 'Person', name: a.name })),
    image: heroSrc,
    mainEntityOfPage: articleUrl,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'The Blog', item: 'https://blog.dvntapp.live/posts' },
        { '@type': 'ListItem', position: 2, name: post.title, item: articleUrl },
      ],
    },
  }

  return (
    <div style={shell as any} className="dvnt-blog">
      <div style={wash as any} />

      {/* Scroll progress — client component, zero layout cost */}
      <ArticleProgress />

      {/* Back nav */}
      <div style={topNav as any}>
        <Link href="/posts" style={back as any}>← Blog</Link>
        {cat && (
          <Link href={`/posts?category=${cat.slug}`} style={{
            padding: '3px 10px', borderRadius: 7, textDecoration: 'none',
            border: `1px solid ${(cat.accentColor ?? '#379ed8')}44`,
            background: `${cat.accentColor ?? '#379ed8'}18`,
            color: cat.accentColor ?? '#379ed8',
            fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
          } as any}>
            {cat.title}
          </Link>
        )}
      </div>

      <main style={main as any}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        {isDraft && (
          <div style={draftBanner as any}>
            <span style={{ color: '#b07ec9', fontSize: 13 } as any}>✎ Draft preview</span>
          </div>
        )}

        {/* ── Cinematic hero image ── */}
        {heroSrc && (
          <div style={heroWrap as any} data-hero>
            <Image
              src={heroSrc}
              alt={post.heroImage?.alt ?? post.coverImage?.alt ?? post.title}
              fill
              sizes="(max-width: 980px) 100vw, 940px"
              style={{ objectFit: 'cover', objectPosition: 'center top' }}
              priority
            />
            <div style={heroOverlay as any} />
            {post.heroCaption && (
              <span style={heroCaption as any}>{post.heroCaption}</span>
            )}
          </div>
        )}

        {/* ── Article layout: prose + sticky sidebar ── */}
        <div style={articleLayout as any}>
          <article style={card as any}>
            <div style={cardEdge as any} className="dvnt-rule dvnt-rule--spine" aria-hidden={true} />

            <header style={{ marginBottom: 36 } as any}>
              <h1 style={titleStyle as any}>{post.title}</h1>
              {post.excerpt && <p style={dek as any}>{post.excerpt}</p>}
              <Byline post={post} />
            </header>

            <section className="dvnt-prose" aria-label="Article body">
              <RichText data={post.content} />
            </section>
            {/* Article-body polish: heading anchors, drop-cap, scroll reveal */}
            <ScrollReveal />

            <Comments postId={post.id} initial={comments} />
          </article>

          {/* Sticky TOC + share — desktop only, collapses to bottom bar on mobile */}
          <ArticleStickyTools toc={toc} title={post.title} url={articleUrl} />
        </div>

        {/* ── Author footer ── */}
        {(post.authors?.length ?? 0) > 0 && (
          <div style={authorSection as any}>
            <span style={authorSectionLabel as any}>About the author{(post.authors?.length ?? 0) > 1 ? 's' : ''}</span>
            {post.authors?.map((a) => <AuthorCard key={a.id} author={a} role={a.role ?? 'Staff Writer'} />)}
            {post.contributors?.map((c) => <AuthorCard key={c.author.id} author={c.author} role={c.role} />)}
          </div>
        )}

        {/* ── Newsletter CTA ── */}
        <NewsletterCTA />

        {/* ── Related posts ── */}
        {latest.length > 0 && (
          <div style={relatedSection as any}>
            <span style={relatedLabel as any}>— More to read</span>
            <div style={relatedGrid as any}>
              {latest.map((p) => (
                <Link key={p.id} href={`/posts/${p.slug}`} style={{ textDecoration: 'none' }} className="dvnt-rel">
                  <article style={relCard as any}>
                    {(p.heroImage || p.coverImage?.url) && (
                      <div style={relImgWrap as any}>
                        <Image
                          src={p.heroImage ? mediaUrl(p.heroImage, 'card') : p.coverImage!.url!}
                          alt={p.heroImage?.alt ?? p.coverImage?.alt ?? p.title}
                          fill sizes="(max-width: 700px) 50vw, 220px" style={{ objectFit: 'cover' }}
                        />
                      </div>
                    )}
                    <div style={{ padding: '12px 14px 16px' } as any}>
                      <h2 style={relTitle as any}>{p.title}</h2>
                      {p.publishedAt && <time style={relMeta as any}>{formatDateShort(p.publishedAt)}</time>}
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
      <style>{CSS}</style>
    </div>
  )
}

// ─── Byline ───────────────────────────────────────────────────────────────

function Byline({ post }: { post: Post }) {
  const authors = post.authors ?? []
  const contributors = post.contributors ?? []

  const grouped = contributors.reduce<Record<string, PostAuthor[]>>((acc, c) => {
    if (!acc[c.role]) acc[c.role] = []
    acc[c.role].push(c.author)
    return acc
  }, {})

  return (
    <div style={bylineRoot as any}>
      {authors.length > 0 && (
        <div style={bylineRow as any}>
          <div style={avatarStack as any}>
            {authors.slice(0, 3).map((a, i) => <AuthorAvatar key={a.id} author={a} index={i} size={36} />)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 } as any}>
            <span style={bylineNames as any}>{formatByline(authors)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as any}>
              {post.publishedAt && (
                <time style={metaSmall as any}>{formatDate(post.publishedAt)}</time>
              )}
              {post.publishedAt && post.readTime && <span style={metaDot as any}>·</span>}
              {post.readTime && <span style={metaSmall as any}>{post.readTime} min read</span>}
            </div>
          </div>
        </div>
      )}
      {Object.entries(grouped).map(([role, contribs]) => (
        <div key={role} style={contribRow as any}>
          <div style={avatarStack as any}>
            {contribs.map((a, i) => <AuthorAvatar key={a.id} author={a} index={i} size={22} />)}
          </div>
          <span style={contribText as any}>
            <em>{role} </em>
            {contribs.map((a, i) => (
              <span key={a.id}>
                {a.name}{i < contribs.length - 2 ? ', ' : i === contribs.length - 2 ? ' and ' : ''}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function AuthorAvatar({ author, index, size }: { author: PostAuthor; index: number; size: number }) {
  const src = author.avatar ? mediaUrl(author.avatar, 'thumbnail') : null
  const initials = author.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  const r = Math.round(size * 0.27)
  return (
    <div style={{ width: size, height: size, borderRadius: r, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.14)', flexShrink: 0, marginLeft: index > 0 ? Math.round(-size * 0.28) : 0 } as any}>
      {src
        ? <Image src={src} alt={author.name} width={size} height={size} style={{ objectFit: 'cover', borderRadius: r }} />
        : <div style={{ width: '100%', height: '100%', background: 'rgba(135,78,159,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as any}>
            <span style={{ color: '#fff', fontSize: size * 0.35, fontWeight: '700' } as any}>{initials}</span>
          </div>}
    </div>
  )
}

function AuthorCard({ author, role }: { author: PostAuthor; role: string }) {
  const src = author.avatar ? mediaUrl(author.avatar, 'thumbnail') : null
  const initials = author.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={authorCard as any} className="dvnt-author-card">
      <div style={{ width: 52, height: 52, borderRadius: 14, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.14)', flexShrink: 0 } as any}>
        {src
          ? <Image src={src} alt={author.name} width={52} height={52} style={{ objectFit: 'cover', borderRadius: 14 }} />
          : <div style={{ width: '100%', height: '100%', background: 'rgba(135,78,159,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as any}>
              <span style={{ color: '#fff', fontSize: 18, fontWeight: '700' } as any}>{initials}</span>
            </div>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 } as any}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' } as any}>
          <span style={authorName as any}>{author.name}</span>
          <span style={authorRole as any}>{role}</span>
        </div>
        {author.bio && <p style={authorBio as any}>{author.bio}</p>}
        {author.socials && (
          <div style={{ display: 'flex', gap: 12, marginTop: 4 } as any}>
            {author.socials.instagram && (
              <a href={`https://instagram.com/${author.socials.instagram.replace('@', '')}`} style={socialLink as any} target="_blank" rel="noopener noreferrer">IG</a>
            )}
            {author.socials.twitter && (
              <a href={`https://x.com/${author.socials.twitter.replace('@', '')}`} style={socialLink as any} target="_blank" rel="noopener noreferrer">X</a>
            )}
            {author.socials.tiktok && (
              <a href={`https://tiktok.com/@${author.socials.tiktok.replace('@', '')}`} style={socialLink as any} target="_blank" rel="noopener noreferrer">TikTok</a>
            )}
            {author.socials.onlyfans && (
              <a href={`https://onlyfans.com/${author.socials.onlyfans.replace('@', '')}`} style={socialLink as any} target="_blank" rel="noopener noreferrer">OnlyFans ↗</a>
            )}
            {author.socials.website && (
              <a href={author.socials.website} style={socialLink as any} target="_blank" rel="noopener noreferrer">Web ↗</a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const shell = { minHeight: '100vh', backgroundColor: '#07090c', color: '#FAFAF9' }
const wash = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(70% 42% at 50% 0%, rgba(135,78,159,0.30) 0%, rgba(116,63,146,0.12) 38%, rgba(7,9,12,0) 78%)' }
const main = { maxWidth: 900, margin: '0 auto', width: '100%', padding: '40px 24px 120px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 48 }
const topNav = { maxWidth: 900, margin: '0 auto', padding: '140px 24px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
const back = { color: '#379ed8', fontSize: 13, fontWeight: '600', letterSpacing: 0.4, fontFamily: MONO, textDecoration: 'none' }
const draftBanner = { borderRadius: 10, backgroundColor: 'rgba(176,126,201,0.12)', padding: '8px 14px', alignSelf: 'flex-start' }

// Article layout: prose column + sticky sidebar
const articleLayout = { display: 'flex', alignItems: 'flex-start', gap: 0 }

// Hero
const heroWrap = { position: 'relative', width: '100%', aspectRatio: '21/9', borderRadius: 'clamp(12px,2vw,20px)', overflow: 'hidden', viewTransitionName: 'post-hero' }
const heroOverlay = { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: 'linear-gradient(to top, rgba(7,9,12,0.85) 0%, transparent 100%)' }
const heroCaption = { position: 'absolute', bottom: 12, left: 16, right: 16, color: 'rgba(245,245,244,0.5)', fontSize: 11, fontFamily: MONO, letterSpacing: 0.4 }

// Card
const card = { position: 'relative', borderRadius: 24, border: '1px solid rgba(255,255,255,0.09)', backgroundColor: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)', padding: 'clamp(24px,4vw,48px)', overflow: 'hidden' }
// Animated brand spine — gradient + drift come from `.dvnt-rule--spine`; this
// object only positions it down the left edge of the article card.
const cardEdge = { position: 'absolute', left: 0, top: 28, bottom: 28 }
const titleStyle = { margin: '0 0 14px', fontFamily: DISPLAY, fontSize: 'clamp(28px,4.5vw,52px)', lineHeight: 1.04, fontWeight: '900', letterSpacing: '0.03em', textTransform: 'uppercase', wordSpacing: '0.04em', color: '#FAFAF9' }
const dek = { margin: '0 0 20px', color: 'rgba(245,245,244,0.7)', fontSize: 18, lineHeight: '1.6', fontFamily: SANS }

// Byline
const bylineRoot = { display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 28 }
const bylineRow = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
const avatarStack = { display: 'flex', alignItems: 'center' }
const bylineNames = { color: '#FAFAF9', fontSize: 14, fontWeight: '600', fontFamily: SANS }
const metaSmall = { color: 'rgba(245,245,244,0.45)', fontSize: 12, fontFamily: MONO }
const metaDot = { color: 'rgba(245,245,244,0.25)', fontSize: 12 }
const contribRow = { display: 'flex', alignItems: 'center', gap: 8 }
const contribText = { color: 'rgba(245,245,244,0.5)', fontSize: 12, fontFamily: MONO }

// Author cards
const authorSection = { display: 'flex', flexDirection: 'column', gap: 16 }
const authorSectionLabel = { display: 'block', color: '#b07ec9', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }
const authorCard = { display: 'flex', gap: 16, alignItems: 'flex-start', padding: '18px 20px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.09)', backgroundColor: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)' }
const authorName = { color: '#FAFAF9', fontSize: 15, fontWeight: '800', fontFamily: DISPLAY, letterSpacing: '0.05em', textTransform: 'uppercase' }
const authorRole = { color: '#b07ec9', fontSize: 11, fontFamily: MONO, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }
const authorBio = { margin: 0, color: 'rgba(245,245,244,0.62)', fontSize: 13, lineHeight: '1.6' }
const socialLink = { color: 'rgba(55,158,216,0.8)', fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: 1, textDecoration: 'none' }

// Related
const relatedSection = { display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }
const relatedLabel = { display: 'block', color: '#b07ec9', fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }
const relatedGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 14 }
const relCard = { borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', backgroundColor: 'rgba(14,19,24,0.72)', backdropFilter: 'saturate(160%) blur(18px)' }
const relImgWrap = { position: 'relative', width: '100%', aspectRatio: '3/2', overflow: 'hidden' }
const relTitle = { margin: '0 0 6px', color: '#FAFAF9', fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, lineHeight: '1.2', letterSpacing: '0.05em', textTransform: 'uppercase' }
const relMeta = { color: 'rgba(245,245,244,0.4)', fontSize: 11, fontFamily: MONO }

const CSS = `
/* ── Article layout ── */
/* Desktop: article takes the full card width; sticky rail floats outside */
@media(min-width:1101px){
  [data-article-layout]{align-items:flex-start}
}
@media(max-width:1100px){
  /* Hide the sidebar rail on small screens (mobile bar shown instead) */
  [data-article-layout]>aside{display:none!important}
}

/* On phones the 21:9 hero is too thin — give it more height */
@media(max-width:640px){
  [data-hero]{aspect-ratio:16/10}
}

/* ── Hero entrance ── */
[data-hero]{animation:dvntHeroIn .9s cubic-bezier(0.22,1,0.36,1) both}
@keyframes dvntHeroIn{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}

/* ── Prose typography ── */
.dvnt-prose{
  color:rgba(245,245,244,0.87);
  font-family:${SANS};
  font-size:clamp(16px,1.15vw,18px);
  line-height:1.82;
  max-width:680px;
}
.dvnt-prose p{margin:0 0 1.3em}
.dvnt-prose h2,.dvnt-prose h3{
  color:#FAFAF9;
  font-family:${DISPLAY};
  letter-spacing:0.04em;
  text-transform:uppercase;
  line-height:1.12;
  margin:2.2em 0 .6em;
  scroll-margin-top:100px;
}
.dvnt-prose h2{font-size:clamp(18px,2vw,24px);font-weight:900}
.dvnt-prose h3{font-size:clamp(15px,1.6vw,19px);font-weight:800}
.dvnt-prose a{color:#b07ec9;text-decoration:none;border-bottom:1px solid rgba(176,126,201,0.35);transition:color .15s,border-color .15s}
.dvnt-prose a:hover{color:#379ed8;border-color:#379ed8}
.dvnt-prose ul,.dvnt-prose ol{margin:0 0 1.3em;padding-left:1.5em}
.dvnt-prose li{margin:.4em 0;line-height:1.7}
.dvnt-prose ul li::marker{color:#379ed8}
.dvnt-prose ol li::marker{color:#874e9f;font-weight:700}

/* Pull quote */
.dvnt-prose blockquote{
  margin:2em -4px;
  padding:20px 24px 20px 28px;
  border:none;
  border-left:4px solid transparent;
  border-image:linear-gradient(180deg,#b07ec9,#379ed8) 1;
  background:rgba(135,78,159,0.07);
  border-radius:0 12px 12px 0;
  font-style:italic;
  font-size:1.08em;
  color:rgba(245,245,244,0.82);
  line-height:1.65;
}
.dvnt-prose blockquote p{margin:0}

/* Images */
.dvnt-prose img{border-radius:14px;max-width:100%;margin:2em 0;display:block;box-shadow:0 8px 32px rgba(0,0,0,0.4)}
.dvnt-prose figure{margin:2em 0}
.dvnt-prose figcaption{margin-top:8px;font-size:12px;color:rgba(245,245,244,0.4);font-family:${MONO};letter-spacing:.3px}

/* Code */
.dvnt-prose code{font-family:${MONO};background:rgba(255,255,255,0.08);padding:2px 7px;border-radius:6px;font-size:.875em;color:#b07ec9}
.dvnt-prose pre{background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:1.3em 1.6em;overflow-x:auto;margin:1.8em 0}
.dvnt-prose pre code{background:none;padding:0;color:rgba(245,245,244,0.9);font-size:.92em}

/* HR / divider */
.dvnt-prose hr{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:2.5em 0}

/* ── Related cards ── */
.dvnt-rel article{transition:transform .3s cubic-bezier(0.22,1,0.36,1),border-color .3s ease}
.dvnt-rel:hover article{transform:translateY(-4px);border-color:rgba(55,158,216,0.22)!important;box-shadow:0 16px 40px rgba(0,0,0,0.4)}

/* ── Author cards ── */
.dvnt-author-card{transition:border-color .2s ease,box-shadow .2s ease}
.dvnt-author-card:hover{border-color:rgba(176,126,201,0.25)!important;box-shadow:0 4px 20px rgba(176,126,201,0.06)}

/* ── Back link hover ── */
a[style*="379ed8"]:hover{opacity:.8}

@media(prefers-reduced-motion:reduce){
  [data-hero]{animation:none}
  .dvnt-rel article,.dvnt-author-card,.dvnt-prose a{transition:none}
}`
