// src/components/RichText/index.tsx
// Renders Payload Lexical content as JSX using the official converter, with an
// internal-link resolver mapping posts/categories to blog URLs.
import React from 'react'
import {
  RichText as PayloadRichText,
  type JSXConvertersFunction,
  LinkJSXConverter,
} from '@payloadcms/richtext-lexical/react'
import YouTubeEmbed from '@dvnt/cms/components/YouTubeEmbed'

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

const jsxConverters: JSXConvertersFunction = ({ defaultConverters }) => {
  const converters = { ...defaultConverters, ...LinkJSXConverter({ internalDocToHref }) }
  converters.blocks = {
    ...defaultConverters.blocks,
    youtube: ({ node }: { node: { fields: Record<string, unknown> } }) => <YouTubeEmbed {...node.fields} />,
    videoEmbed: ({ node }: { node: { fields: Record<string, unknown> } }) => <YouTubeEmbed {...node.fields} />,
  }
  return converters
}

export function RichText({ data }: { data: any }) {
  if (!data) return null
  return <PayloadRichText converters={jsxConverters} data={data} />
}
