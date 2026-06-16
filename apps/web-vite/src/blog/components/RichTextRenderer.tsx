// src/blog/components/RichTextRenderer.tsx
// Renders Payload's contentHtml with DVNT editorial typography.
// Wraps a dangerouslySetInnerHTML div (the only place we use raw HTML in this app).
// All pull quotes, gallery blocks, etc. are extracted from the HTML by the
// Lexical → HTML pipeline and rendered with their own semantic markup.
import { useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { addBreadcrumb, capturePostError } from '../sentry'

type Props = {
  html: string
  slug?: string
}

export function RichTextRenderer({ html, slug }: Props) {
  const ref = useRef<any>(null)

  useEffect(() => {
    try {
      addBreadcrumb('block.rendered', 'Rich text rendered', { slug: slug ?? '' })
      // Inject heading IDs for TOC anchor linking
      if (ref.current) {
        ref.current.querySelectorAll('h2, h3').forEach((el: HTMLElement) => {
          if (!el.id) {
            el.id = el.textContent
              ?.toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, '')
              .replace(/[\s_]+/g, '-') ?? ''
          }
        })
      }
    } catch (err) {
      capturePostError(err, { operation: 'RichTextRenderer', slug })
    }
  }, [html, slug])

  return (
    <View style={s.root}>
      {/* The blog-article class triggers the editorial typography in globals.css */}
      <div
        ref={ref}
        className="blog-article-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  root: { width: '100%' as any },
})
