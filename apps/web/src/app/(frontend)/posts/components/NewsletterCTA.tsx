'use client'
// DVNT-branded newsletter + app download CTA module.
// Server-renderable shell with client submit interaction.
import { useState } from 'react'

const SANS = 'var(--font-geist-sans), system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export function NewsletterCTA() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setState('loading')
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setState('done')
    } catch (err) {
      console.error('[NewsletterCTA]', err)
      setState('error')
    }
  }

  return (
    <section style={wrap as any} aria-label="Newsletter signup">
      <div style={glow as any} aria-hidden="true" />
      <div style={inner as any}>
        <span style={eyebrow as any}>✦ DVNT Dispatch</span>
        <h2 style={heading as any}>
          Stay in the loop.<br />
          <span style={{ color: '#379ed8' }}>Never miss a night.</span>
        </h2>
        <p style={body as any}>
          The underground calendar. The culture. The editorial. Direct to you, no algorithm.
        </p>

        {state === 'done' ? (
          <p style={successMsg as any}>
            <span style={{ color: '#b07ec9', marginRight: 8 }}>✓</span>
            You&apos;re in. See you in the dark.
          </p>
        ) : state === 'error' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ ...successMsg, background: 'rgba(55,158,216,0.07)', border: '1px solid rgba(55,158,216,0.18)', margin: 0 } as any}>
              <span style={{ color: '#379ed8', marginRight: 8 }}>✕</span>
              Something went wrong — try again.
            </p>
            <button onClick={() => setState('idle')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#b07ec9', fontSize: 12, fontFamily: MONO, cursor: 'pointer', letterSpacing: 0.5 }}>
              Try again
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={form as any} noValidate>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              aria-label="Email address"
              style={input as any}
              disabled={state === 'loading'}
            />
            <button
              type="submit"
              disabled={state === 'loading' || !email.trim()}
              style={btn as any}
              aria-label="Subscribe to DVNT Dispatch"
            >
              {state === 'loading' ? '…' : 'Subscribe'}
            </button>
          </form>
        )}

      </div>
      <style>{CSS}</style>
    </section>
  )
}

const wrap: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: 24,
  border: '1px solid rgba(55,158,216,0.18)',
  background: 'rgba(14,19,24,0.72)',
  backdropFilter: 'saturate(160%) blur(20px)',
  padding: 'clamp(32px,5vw,56px)',
}

const glow: React.CSSProperties = {
  position: 'absolute',
  top: -60,
  right: -60,
  width: 280,
  height: 280,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(55,158,216,0.18) 0%, transparent 70%)',
  pointerEvents: 'none',
}

const inner: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 540,
}

const eyebrow: React.CSSProperties = {
  color: '#379ed8',
  fontSize: 10,
  fontFamily: MONO,
  fontWeight: 700,
  letterSpacing: 2,
  textTransform: 'uppercase',
}

const heading: React.CSSProperties = {
  margin: 0,
  color: '#FAFAF9',
  fontFamily: SANS,
  fontSize: 'clamp(24px,3.5vw,36px)',
  fontWeight: 800,
  lineHeight: 1.15,
  letterSpacing: '-0.03em',
}

const body: React.CSSProperties = {
  margin: 0,
  color: 'rgba(245,245,244,0.6)',
  fontSize: 15,
  lineHeight: '1.65',
  fontFamily: SANS,
}

const form: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 4,
}

const input: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  height: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#FAFAF9',
  fontSize: 14,
  fontFamily: SANS,
  outline: 'none',
}

const btn: React.CSSProperties = {
  height: 44,
  padding: '0 24px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #5b2c81, #743f92, #2981af, #379ed8)',
  color: '#fff',
  fontSize: 14,
  fontFamily: SANS,
  fontWeight: 700,
  cursor: 'pointer',
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
}

const successMsg: React.CSSProperties = {
  margin: 0,
  color: 'rgba(245,245,244,0.8)',
  fontSize: 15,
  fontFamily: SANS,
  padding: '12px 16px',
  borderRadius: 12,
  background: 'rgba(176,126,201,0.08)',
  border: '1px solid rgba(176,126,201,0.15)',
}

const appRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 4,
  paddingTop: 20,
  borderTop: '1px solid rgba(255,255,255,0.07)',
}

const appLabel: React.CSSProperties = {
  color: 'rgba(245,245,244,0.35)',
  fontSize: 11,
  fontFamily: MONO,
  letterSpacing: 1,
}

const appBadge: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(245,245,244,0.7)',
  fontSize: 12,
  fontFamily: MONO,
  fontWeight: 600,
  textDecoration: 'none',
  letterSpacing: 0.5,
}

const CSS = `
input:focus{border-color:rgba(55,158,216,0.5)!important;box-shadow:0 0 0 3px rgba(55,158,216,0.12)}
button[type=submit]:hover:not(:disabled){filter:brightness(1.1)}
button[type=submit]:disabled{opacity:0.5;cursor:default}
a[style]:hover{border-color:rgba(55,158,216,0.4)!important;color:#FAFAF9!important}`
