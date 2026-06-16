// src/components/RichText/index.tsx
// Renders Payload Lexical content as JSX using the official converter, with an
// internal-link resolver mapping posts/categories to blog URLs.
import React from 'react'
import {
  RichText as PayloadRichText,
  type JSXConvertersFunction,
  LinkJSXConverter,
} from '@payloadcms/richtext-lexical/react'
import type { DefaultNodeTypes } from '@payloadcms/richtext-lexical'

const internalDocToHref = ({ linkNode }: any) => {
  const rel = linkNode.fields?.doc?.relationTo
  const value = linkNode.fields?.doc?.value
  const slug = typeof value === 'object' ? value?.slug : value
  switch (rel) {
    case 'posts':
      return `/${slug}` // blog.dvntapp.live/<slug>
    case 'categories':
      return `/category/${slug}`
    default:
      return `/${slug}`
  }
}

const jsxConverters: JSXConvertersFunction<DefaultNodeTypes> = ({ defaultConverters }) => ({
  ...defaultConverters,
  ...LinkJSXConverter({ internalDocToHref }),
})

export function RichText({ data }: { data: any }) {
  if (!data) return null
  return <PayloadRichText converters={jsxConverters} data={data} />
}
