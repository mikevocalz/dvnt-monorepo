'use client'
// Sticky share + TOC rail. Floats right of the article column on ≥1100px,
// collapses to a bottom bar on mobile. Zero external dependencies.
import { useEffect, useRef, useState, useCallback } from 'react'

const SANS = 'var(--font-geist-sans), system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export type TocItem = { id: string; text: string; level: 2 | 3 }

interface Props {
  toc: TocItem[]
  title: string
  url: string
}

export function ArticleStickyTools({ toc, title, url }: Props) {
  const [activeId, setActiveId] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Highlight active heading as user scrolls
  useEffect(() => {
    if (!toc.length) return
    const ids = toc.map((t) => t.id)
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (!els.length) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveId(e.target.id)
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    )
    els.forEach((el) => observerRef.current!.observe(el))
    return () => observerRef.current?.disconnect()
  }, [toc])

  const share = useCallback(async (platform: 'copy' | 'twitter' | 'ig') => {
    if (platform === 'copy') {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else if (platform === 'twitter') {
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener')
    }
  }, [title, url])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top, behavior: 'smooth' })
    setTocOpen(false)
  }

  if (!toc.length) {
    return (
      <aside className="dvnt-toc-share" style={sideRail as any} aria-label="Share article">
        <ShareButtons share={share} copied={copied} />
      </aside>
    )
  }

  return (
    <>
      {/* Desktop: sidebar rail (hidden ≤1100px by .dvnt-toc-share) */}
      <aside className="dvnt-toc-share" style={sideRail as any} aria-label="Article navigation and share">
        <ShareButtons share={share} copied={copied} />
        <div style={divider} />
        <nav aria-label="Table of contents">
          <p style={tocLabel}>Contents</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {toc.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => scrollTo(item.id)}
                  style={{
                    ...tocItem,
                    paddingLeft: item.level === 3 ? 18 : 0,
                    color: activeId === item.id ? '#379ed8' : 'rgba(245,245,244,0.45)',
                    borderLeft: `2px solid ${activeId === item.id ? '#379ed8' : 'transparent'}`,
                  }}
                  aria-current={activeId === item.id ? 'location' : undefined}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Mobile: floating bottom TOC toggle (hidden ≥1101px by .dvnt-mobile-toc) */}
      <div className="dvnt-mobile-toc" style={mobileTocBar as any}>
        <button
          style={mobileTocBtn as any}
          onClick={() => setTocOpen((v) => !v)}
          aria-label="Toggle table of contents"
        >
          <span style={{ fontSize: 13, fontFamily: MONO, fontWeight: 700, letterSpacing: 1 }}>
            {tocOpen ? '✕ Close' : '☰ Contents'}
          </span>
        </button>
        <button onClick={() => share('copy')} style={mobileShareBtn as any} aria-label="Copy link">
          {copied ? '✓' : '⎘'}
        </button>
        <button onClick={() => share('twitter')} style={mobileShareBtn as any} aria-label="Share on X">𝕏</button>
      </div>

      {tocOpen && (
        <div style={mobileDrawer as any} role="dialog" aria-label="Table of contents">
          <nav>
            {toc.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                style={{
                  ...drawerItem,
                  paddingLeft: item.level === 3 ? 28 : 0,
                  color: activeId === item.id ? '#379ed8' : 'rgba(245,245,244,0.7)',
                }}
              >
                {item.text}
              </button>
            ))}
          </nav>
        </div>
      )}
      <style>{CSS}</style>
    </>
  )
}

function ShareButtons({ share, copied }: { share: (p: 'copy' | 'twitter' | 'ig') => void; copied: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <p style={shareLabel}>Share</p>
      <button onClick={() => share('copy')} style={shareBtn as any} aria-label="Copy link" title="Copy link">
        <span style={{ fontSize: 16 }}>{copied ? '✓' : '⎘'}</span>
        {copied && <span style={{ position: 'absolute', bottom: -20, fontSize: 9, fontFamily: MONO, color: '#b07ec9', whiteSpace: 'nowrap' }}>Copied!</span>}
      </button>
      <button onClick={() => share('twitter')} style={shareBtn as any} aria-label="Share on X" title="Share on X">
        <span style={{ fontSize: 14, fontWeight: 700 }}>𝕏</span>
      </button>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const sideRail: React.CSSProperties = {
  position: 'sticky',
  top: 140,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 40,
  alignSelf: 'flex-start',
  marginLeft: 24,
}

const shareLabel: React.CSSProperties = {
  margin: '0 0 2px',
  color: 'rgba(245,245,244,0.3)',
  fontSize: 8,
  fontFamily: MONO,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  textAlign: 'center',
}

const shareBtn: React.CSSProperties = {
  position: 'relative',
  width: 36,
  height: 36,
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(14,19,24,0.8)',
  backdropFilter: 'blur(12px)',
  color: 'rgba(245,245,244,0.6)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'border-color .2s, color .2s',
}

const divider: React.CSSProperties = {
  width: '100%',
  height: 1,
  background: 'rgba(255,255,255,0.07)',
  margin: '8px 0',
}

const tocLabel: React.CSSProperties = {
  margin: '0 0 8px',
  color: 'rgba(245,245,244,0.3)',
  fontSize: 8,
  fontFamily: MONO,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
}

const tocItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  padding: '5px 0 5px 8px',
  fontSize: 11,
  fontFamily: SANS,
  lineHeight: 1.4,
  cursor: 'pointer',
  transition: 'color .15s, border-color .15s',
  marginBottom: 2,
}

const mobileTocBar: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '10px 16px',
  borderRadius: 999,
  background: 'rgba(14,19,24,0.88)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  zIndex: 1000,
}

const mobileTocBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(245,245,244,0.8)',
  cursor: 'pointer',
  padding: '0 4px',
}

const mobileShareBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'transparent',
  color: 'rgba(245,245,244,0.7)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
}

const mobileDrawer: React.CSSProperties = {
  position: 'fixed',
  bottom: 80,
  left: 16,
  right: 16,
  maxHeight: '55vh',
  overflowY: 'auto',
  borderRadius: 20,
  background: 'rgba(14,19,24,0.96)',
  backdropFilter: 'blur(24px)',
  border: '1px solid rgba(255,255,255,0.12)',
  padding: '16px 20px',
  zIndex: 1001,
  boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
}

const drawerItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  padding: '10px 0',
  fontSize: 15,
  fontFamily: SANS,
  cursor: 'pointer',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}

const CSS = `
button[style]:hover{opacity:.85}
/* Desktop rail visible only ≥1101px; mobile bottom bar only ≤1100px. Use
   !important so these win over the components' inline display:flex. */
@media(max-width:1100px){.dvnt-toc-share{display:none!important}}
@media(min-width:1101px){.dvnt-mobile-toc{display:none!important}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`
