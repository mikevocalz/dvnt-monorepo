'use client'
// Client component: category filter rail — updates URL search params on click.
import { useRouter, usePathname } from 'next/navigation'
import type { BlogCategory } from '@/lib/blog-api'

const MONO = 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace'

export function BlogCategoryFilter({
  categories,
  active,
}: {
  categories: BlogCategory[]
  active?: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  const select = (slug: string | null) => {
    const url = slug ? `${pathname}?category=${slug}` : pathname
    router.push(url)
  }

  return (
    <div style={rail} aria-label="Filter by category" role="navigation">
      <button
        onClick={() => select(null)}
        style={chip(!active)}
        aria-current={!active ? 'page' : undefined}
      >
        All
      </button>
      {categories.map((cat) => {
        const accent = cat.accentColor ?? '#FF5BFC'
        const isActive = active === cat.slug
        return (
          <button
            key={cat.id}
            onClick={() => select(cat.slug)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              padding: '6px 16px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${isActive ? `${accent}55` : 'rgba(255,255,255,0.10)'}`,
              background: isActive ? `${accent}1a` : 'transparent',
              color: isActive ? accent : 'rgba(245,245,244,0.55)',
              fontSize: 12, fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8,
              transition: 'all .2s ease',
            }}
          >
            {cat.title}
          </button>
        )
      })}
      <style>{`button:focus-visible { outline: 2px solid #FF5BFC; outline-offset: 2px; }`}</style>
    </div>
  )
}

const rail: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '6px 16px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(255,91,252,0.45)' : 'rgba(255,255,255,0.10)'}`,
    background: active ? 'rgba(255,91,252,0.12)' : 'transparent',
    color: active ? '#FF5BFC' : 'rgba(245,245,244,0.55)',
    fontSize: 12, fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8,
    transition: 'all .2s ease',
  }
}
