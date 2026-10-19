'use client'

import React from 'react'
import { BlockCollapsible } from '@payloadcms/richtext-lexical/client'
import { useFormFields } from '@payloadcms/ui'
import YouTubeEmbed from './YouTubeEmbed'

export default function YouTubeBlockPreview() {
  const url = useFormFields(([fields]) => fields.url?.value)
  const title = useFormFields(([fields]) => fields.title?.value)
  const caption = useFormFields(([fields]) => fields.caption?.value)
  return (
    <BlockCollapsible>
      <YouTubeEmbed url={url} title={title} caption={caption} />
      <p style={{ margin: 0, opacity: 0.75 }}>Use Edit to change the YouTube URL, video title or caption.</p>
    </BlockCollapsible>
  )
}
