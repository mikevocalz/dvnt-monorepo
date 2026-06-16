// src/blog/components/NewsletterCTA.tsx
// In-article newsletter capture block — DVNT glass style.
import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { addBreadcrumb, capturePostError } from '../sentry'
import { color, font, space, radius, SANS, MONO } from '../../dashboard/theme/tokens'

type Props = {
  headline?: string
  body?: string
  placeholder?: string
  buttonLabel?: string
}

export function NewsletterCTA({
  headline = 'Stay in the loop',
  body = 'Get DVNT culture, events, and editorial straight to your inbox.',
  placeholder = 'Your email address',
  buttonLabel = 'Subscribe',
}: Props) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const submit = async () => {
    if (!email.includes('@')) return
    setState('loading')
    addBreadcrumb('newsletter.submitted', 'Newsletter CTA submitted')
    try {
      // Post to /api/newsletter if wired up; gracefully no-ops otherwise.
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setState(res.ok ? 'done' : 'error')
    } catch (err) {
      capturePostError(err, { operation: 'NewsletterCTA' })
      setState('error')
    }
  }

  return (
    <View style={s.root} accessibilityRole="form" aria-label="Newsletter signup">
      {/* Glow accent */}
      <View style={s.glow} pointerEvents="none" aria-hidden="true" />

      <Text style={s.kicker}>Newsletter</Text>
      <Text style={s.headline}>{headline}</Text>
      {body ? <Text style={s.body}>{body}</Text> : null}

      {state === 'done' ? (
        <Text style={s.success}>You're in. ✦</Text>
      ) : (
        <View style={s.form}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={placeholder}
            placeholderTextColor={color.textFaint}
            keyboardType="email-address"
            style={s.input}
          />
          <Pressable
            onPress={submit}
            disabled={state === 'loading'}
            style={({ hovered }: any) => [s.btn, hovered && s.btnHover, state === 'loading' && s.btnLoading]}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
          >
            <Text style={s.btnText}>{state === 'loading' ? '…' : buttonLabel}</Text>
          </Pressable>
        </View>
      )}

      {state === 'error' && (
        <Text style={s.error}>Something went wrong. Try again.</Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: {
    position: 'relative' as any,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,91,252,0.25)',
    backgroundColor: 'rgba(8,10,20,0.82)',
    backdropFilter: 'saturate(160%) blur(24px)' as any,
    padding: space.xxl,
    gap: space.md as any,
    overflow: 'hidden',
    marginVertical: space.xxl,
  },
  glow: {
    position: 'absolute' as any,
    top: -40,
    left: '50%' as any,
    transform: [{ translateX: -120 }],
    width: 240,
    height: 120,
    borderRadius: 120,
    backgroundColor: 'rgba(255,91,252,0.12)',
    filter: 'blur(40px)' as any,
  },
  kicker: {
    color: color.brand,
    fontSize: 10,
    fontFamily: MONO as any,
    fontWeight: '700',
    letterSpacing: 2.5,
    textTransform: 'uppercase' as any,
  },
  headline: {
    color: color.text,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: SANS as any,
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  body: {
    color: color.textDim,
    fontSize: font.sm,
    lineHeight: 22,
  },
  form: {
    flexDirection: 'row',
    gap: space.sm as any,
    marginTop: space.sm,
    flexWrap: 'wrap' as any,
  },
  input: {
    flex: 1,
    minWidth: 200,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: color.text,
    fontSize: font.sm,
    outlineStyle: 'none' as any,
  },
  btn: {
    backgroundColor: color.brand,
    borderRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnHover: { opacity: 0.85 },
  btnLoading: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: font.sm, fontWeight: '700' },
  success: {
    color: color.success,
    fontSize: font.md,
    fontWeight: '600',
    fontFamily: SANS as any,
    marginTop: space.sm,
  },
  error: {
    color: color.danger,
    fontSize: font.xs,
    marginTop: 4,
  },
})
