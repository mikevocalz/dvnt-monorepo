import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHeadlessEditor } from '@lexical/headless'
import { ServerBlockNode } from '@payloadcms/richtext-lexical'
import { convertLexicalToHTMLAsync } from '@payloadcms/richtext-lexical/html-async'
import { fieldSchemasToFormState } from '@payloadcms/ui/forms/fieldSchemasToFormState'
import { reduceFieldsToValues } from 'payload/shared'
import { YouTubeBlock } from '../blocks/YouTube.ts'
import { youtubeVideoID, youtubeEmbed, validateYouTubeURL } from './youtube.ts'
import { postHTMLConverters, youtubeHTML } from './youtube-html.ts'
import YouTubeEmbed from '../components/YouTubeEmbed.tsx'
import { RichText } from '../../../../apps/web/src/components/RichText/index.tsx'

const id = 'dQw4w9WgXcQ'
const supported = [
  `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?feature=share&v=${id}&t=20`,
  `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}`,
  `https://youtu.be/${id}?si=share`, `http://www.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/shorts/${id}`, `https://youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}`, `https://youtube.com/live/${id}/`,
  ` https://youtu.be/${id} `,
]
for (const url of supported) test(`accepts ${url.trim()}`, () => {
  assert.equal(youtubeVideoID(url), id)
  assert.equal(validateYouTubeURL(url), true)
  assert.equal(youtubeEmbed(url)?.src, `https://www.youtube-nocookie.com/embed/${id}`)
})

const invalid = [
  undefined, null, {}, 42, '', id, 'youtube.com/watch?v=' + id,
  `javascript:alert(1)`, `data:text/html,<iframe>`, `//youtube.com/watch?v=${id}`,
  `https://youtube.com.evil.example/watch?v=${id}`, `https://evilyoutube.com/watch?v=${id}`,
  `https://youtube.com@evil.example/watch?v=${id}`, `https://evil@youtube.com/watch?v=${id}`,
  `https://youtube.com:444/watch?v=${id}`, `https://youtu.be/${id}/extra`,
  `https://youtube.com/watch?v=${id}&v=aaaaaaaaaaa`, `https://youtube.com/watch?v=${id}x`,
  `https://youtube.com/watch?v=short`, `https://youtube.com/shorts/${id}x`,
  `https://youtube.com/playlist?list=${id}`, `https://youtube.com/watch?v=${id}%22%3E`,
  `https://you\ntube.com/watch?v=${id}`, `https://youtube.com\\@evil.example/watch?v=${id}`,
  `<iframe src="https://youtube.com/embed/${id}"></iframe>`, `https://vimeo.com/123456`,
]
for (const [index, url] of invalid.entries()) test(`rejects unsafe or unsupported URL ${index}`, () => {
  assert.equal(youtubeVideoID(url), null)
  assert.equal(youtubeEmbed(url), null)
  assert.equal(typeof validateYouTubeURL(url), 'string')
  for (const html of [youtubeHTML({ url }), renderToStaticMarkup(<YouTubeEmbed url={url} />)]) {
    assert.doesNotMatch(html, /<iframe|<script|src=|href=/)
    assert.match(html, /Video unavailable/)
  }
})

const paragraph = (text: string) => ({ type: 'paragraph', version: 1, format: '', direction: null, indent: 0,
  children: [{ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' }] })
const block = (blockType = 'youtube', url = supported[0]) => ({ type: 'block', version: 2, format: '', fields: {
  id: 'video-fixture', blockType, blockName: 'Fixture video', url, title: 'Community interview', caption: 'Watch the interview.',
} })
const document = (...children: unknown[]) => ({ root: { type: 'root', version: 1, format: '', direction: null, indent: 0, children } })

test('new block offers a validated native URL field, accessible title, caption and preview', () => {
  assert.equal(YouTubeBlock.slug, 'youtube')
  assert.equal(YouTubeBlock.admin?.components?.Block, '@dvnt/cms/components/YouTubeBlockPreview')
  const url = YouTubeBlock.fields.find((field: any) => field.name === 'url') as any
  assert.equal(url.required, true)
  assert.equal(url.validate, validateYouTubeURL)
  assert.ok(YouTubeBlock.fields.some((field: any) => field.name === 'title'))
  assert.ok(!YouTubeBlock.fields.some((field: any) => field.name === 'autoplay'))
})

test('Payload block form serialization and actual Lexical import/export preserve neighboring content and legacy video fields', async () => {
  const fields = block().fields
  const state = await fieldSchemasToFormState({ fields: YouTubeBlock.fields, data: fields, operation: 'update',
    permissions: true, renderAllFields: true, skipValidation: true,
    req: { payload: { config: { localization: false }, logger: console } },
  } as any)
  const saved = reduceFieldsToValues(state, true) as any
  assert.equal(saved.url, fields.url)
  assert.equal(saved.title, fields.title)
  state.url.value = `https://youtu.be/${id}`
  assert.equal((reduceFieldsToValues(state, true) as any).url, `https://youtu.be/${id}`)
  const legacy = { ...block('videoEmbed'), fields: { ...block('videoEmbed').fields, autoplay: true, poster: 21 } }
  const data = document(paragraph('Before'), block(), legacy, paragraph('After'))
  const editor = createHeadlessEditor({ nodes: [ServerBlockNode], onError: error => { throw error } })
  const first = editor.parseEditorState(JSON.stringify(data)).toJSON()
  const second = editor.parseEditorState(JSON.stringify(first)).toJSON()
  assert.deepEqual(second, first)
  assert.deepEqual((first.root.children[1] as any).fields, fields)
  assert.deepEqual((first.root.children[2] as any).fields, legacy.fields)
  assert.equal((first.root.children[0] as any).children[0].text, 'Before')
  assert.equal((first.root.children[3] as any).children[0].text, 'After')
})

for (const blockType of ['youtube', 'videoEmbed']) test(`${blockType} renders in public JSX and HTML with no autoplay or injected markup`, async () => {
  const video = block(blockType, `${supported[0]}&autoplay=1&origin=https://evil.example`)
  video.fields.title = '\"><img src=x onerror=alert(1)>'
  video.fields.caption = '<script>alert(1)</script> & caption'
  const data = document(paragraph('Before'), video, paragraph('After')) as any
  const original = JSON.stringify(data)
  const htmlOutput = await convertLexicalToHTMLAsync({ data, converters: postHTMLConverters })
  const jsxOutput = renderToStaticMarkup(<RichText data={data} />)
  for (const output of [htmlOutput, jsxOutput]) {
    assert.equal((output.match(/<iframe/g) || []).length, 1)
    assert.match(output, new RegExp(`src="https://www.youtube-nocookie.com/embed/${id}"`))
    assert.match(output, /loading="lazy"/)
    assert.match(output, /title="&quot;&gt;&lt;img/)
    assert.match(output, /aspect-ratio:16 \/ 9/)
    assert.match(output, /width:100%/)
    assert.match(output, /allowfullscreen=""|allowfullscreen /i)
    assert.match(output, /Before/)
    assert.match(output, /After/)
    assert.match(output, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; caption/)
    assert.doesNotMatch(output, /<script|<img|autoplay|evil\.example/)
  }
  assert.equal(JSON.stringify(data), original)
})

test('invalid stored block fails closed in both complete article conversion paths', async () => {
  const data = document(paragraph('Before'), block('youtube', 'javascript:alert(1)'), paragraph('After')) as any
  for (const output of [await convertLexicalToHTMLAsync({ data, converters: postHTMLConverters }), renderToStaticMarkup(<RichText data={data} />)]) {
    assert.doesNotMatch(output, /<iframe|javascript:/)
    assert.match(output, /Before/)
    assert.match(output, /After/)
  }
})

test('ordinary text formatting and links still use Payload defaults', async () => {
  const data = document({ ...paragraph('Bold'), children: [{ ...(paragraph('Bold').children[0]), format: 1 }] },
    { ...paragraph(''), children: [{ type: 'link', version: 3, format: '', direction: null, indent: 0,
      fields: { linkType: 'custom', url: 'https://example.com/story', newTab: false }, children: paragraph('Read more').children }] }) as any
  for (const output of [await convertLexicalToHTMLAsync({ data, converters: postHTMLConverters }), renderToStaticMarkup(<RichText data={data} />)]) {
    assert.match(output, /<strong>Bold<\/strong>/)
    assert.match(output, /href="https:\/\/example.com\/story"/)
    assert.match(output, /Read more/)
  }
  assert.equal(youtubeEmbed(supported[0], '  ')?.title, 'YouTube video player')
})
