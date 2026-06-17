// src/collections/Posts.ts — editorial blog posts with full magazine-grade
// schema: cinematic hero, rich content blocks, editorial flags, SEO/OG, drafts.
import type { CollectionConfig, Block } from 'payload'
import {
  lexicalEditor,
  lexicalHTMLField,
  HeadingFeature,
  BlocksFeature,
  LinkFeature,
  UploadFeature,
  InlineCodeFeature,
  HorizontalRuleFeature,
} from '@payloadcms/richtext-lexical'
import { isAdminPlus, canModerate } from '../access/roles'
import { slugField } from '../fields/slug'

const BLOG_ORIGIN = process.env.BLOG_ORIGIN ?? 'https://blog.dvntapp.live'

// ─── Reusable content blocks ───────────────────────────────────────────────

const PullQuoteBlock: Block = {
  slug: 'pullQuote',
  labels: { singular: 'Pull Quote', plural: 'Pull Quotes' },
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    { name: 'attribution', type: 'text' },
  ],
}

const ImageGalleryBlock: Block = {
  slug: 'imageGallery',
  labels: { singular: 'Image Gallery', plural: 'Image Galleries' },
  fields: [
    {
      name: 'images',
      type: 'array',
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
        { name: 'caption', type: 'text' },
      ],
    },
    {
      name: 'layout',
      type: 'select',
      defaultValue: 'grid',
      options: [
        { label: 'Grid', value: 'grid' },
        { label: 'Masonry', value: 'masonry' },
        { label: 'Carousel', value: 'carousel' },
        { label: 'Full Width', value: 'fullWidth' },
      ],
    },
  ],
}

const VideoEmbedBlock: Block = {
  slug: 'videoEmbed',
  labels: { singular: 'Video Embed', plural: 'Video Embeds' },
  fields: [
    { name: 'url', type: 'text', required: true, admin: { description: 'YouTube, Vimeo, or direct video URL' } },
    { name: 'caption', type: 'text' },
    { name: 'autoplay', type: 'checkbox', defaultValue: false },
    { name: 'poster', type: 'upload', relationTo: 'media' },
  ],
}

const StatBlockItem: Block = {
  slug: 'statBlock',
  labels: { singular: 'Stat Block', plural: 'Stat Blocks' },
  fields: [
    {
      name: 'stats',
      type: 'array',
      fields: [
        { name: 'value', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
        { name: 'description', type: 'text' },
      ],
    },
  ],
}

const EventCalloutBlock: Block = {
  slug: 'eventCallout',
  labels: { singular: 'Event Callout', plural: 'Event Callouts' },
  fields: [
    { name: 'event', type: 'relationship', relationTo: 'events' },
    { name: 'headline', type: 'text' },
    { name: 'ctaLabel', type: 'text', defaultValue: 'Get Tickets' },
    { name: 'ctaUrl', type: 'text' },
  ],
}

const AppCtaBlock: Block = {
  slug: 'appCta',
  labels: { singular: 'App CTA', plural: 'App CTAs' },
  fields: [
    { name: 'headline', type: 'text', defaultValue: 'Experience DVNT' },
    { name: 'body', type: 'textarea' },
    { name: 'ctaLabel', type: 'text', defaultValue: 'Download the App' },
    { name: 'ctaUrl', type: 'text', defaultValue: 'https://dvntapp.live/download' },
    { name: 'image', type: 'upload', relationTo: 'media' },
  ],
}

const NewsletterCtaBlock: Block = {
  slug: 'newsletterCta',
  labels: { singular: 'Newsletter CTA', plural: 'Newsletter CTAs' },
  fields: [
    { name: 'headline', type: 'text', defaultValue: 'Stay in the loop' },
    { name: 'body', type: 'textarea' },
    { name: 'placeholder', type: 'text', defaultValue: 'Your email address' },
    { name: 'buttonLabel', type: 'text', defaultValue: 'Subscribe' },
  ],
}

const RelatedPostsBlock: Block = {
  slug: 'relatedPostsBlock',
  labels: { singular: 'Related Posts Block', plural: 'Related Posts Blocks' },
  fields: [
    { name: 'headline', type: 'text', defaultValue: 'Keep reading' },
    { name: 'posts', type: 'relationship', relationTo: 'posts', hasMany: true },
  ],
}

const TimelineBlock: Block = {
  slug: 'timeline',
  labels: { singular: 'Timeline', plural: 'Timelines' },
  fields: [
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'date', type: 'text', required: true },
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
      ],
    },
  ],
}

const FaqBlock: Block = {
  slug: 'faq',
  labels: { singular: 'FAQ', plural: 'FAQs' },
  fields: [
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'question', type: 'text', required: true },
        { name: 'answer', type: 'textarea', required: true },
      ],
    },
  ],
}

const DividerBlock: Block = {
  slug: 'divider',
  labels: { singular: 'Divider', plural: 'Dividers' },
  fields: [
    {
      name: 'style',
      type: 'select',
      defaultValue: 'line',
      options: [
        { label: 'Line', value: 'line' },
        { label: 'Ornament', value: 'ornament' },
        { label: 'Stars', value: 'stars' },
        { label: 'Space', value: 'space' },
      ],
    },
  ],
}

const SideNoteBlock: Block = {
  slug: 'sideNote',
  labels: { singular: 'Side Note', plural: 'Side Notes' },
  fields: [
    { name: 'body', type: 'textarea', required: true },
    {
      name: 'type',
      type: 'select',
      defaultValue: 'info',
      options: [
        { label: 'Info', value: 'info' },
        { label: 'Warning', value: 'warning' },
        { label: 'Quote', value: 'quote' },
        { label: 'Tip', value: 'tip' },
      ],
    },
  ],
}

const SponsoredDisclosureBlock: Block = {
  slug: 'sponsoredDisclosure',
  labels: { singular: 'Sponsored Disclosure', plural: 'Sponsored Disclosures' },
  fields: [
    { name: 'text', type: 'textarea', defaultValue: 'This content was created in partnership with a brand sponsor.' },
  ],
}

// ─── Collection ─────────────────────────────────────────────────────────────

export const Posts: CollectionConfig = {
  slug: 'posts',
  dbName: 'posts',
  versions: { drafts: { autosave: { interval: 375 } }, maxPerDoc: 25 },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      return { _status: { equals: 'published' } }
    },
    create: isAdminPlus,
    update: isAdminPlus,
    delete: isAdminPlus,
    readVersions: canModerate,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'featured', 'editorsPick', '_status', 'publishedAt'],
    livePreview: {
      url: ({ data }) =>
        `${BLOG_ORIGIN}/blog/${data?.slug}?preview=true&secret=${process.env.PREVIEW_SECRET}`,
    },
    preview: (doc: any) =>
      `${BLOG_ORIGIN}/blog/${doc?.slug}?preview=true&secret=${process.env.PREVIEW_SECRET}`,
  },
  hooks: {
    beforeChange: [
      ({ data, operation }) => {
        if (operation === 'create' || operation === 'update') {
          if (data._status === 'published' && !data.publishedAt)
            data.publishedAt = new Date().toISOString()
          if (!data.readTime && data.contentHtml) {
            const words = (data.contentHtml as string).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
            data.readTime = Math.max(1, Math.ceil(words / 238))
          }
        }
        return data
      },
    ],
  },
  fields: [
    // ─── Core identity ───────────────────────────────────────────────────
    { name: 'title', type: 'text', required: true },
    ...slugField('title'),
    { name: 'excerpt', type: 'textarea', admin: { description: 'Dek / article summary shown in cards and hero.' } },
    { name: 'eyebrow', type: 'text', admin: { description: 'Short label above the title (e.g. "Culture", "Breaking")' } },

    // ─── Hero media ──────────────────────────────────────────────────────
    { name: 'heroImage', type: 'upload', relationTo: 'media', admin: { description: 'Cinematic hero — 16:9 or wider preferred.' } },
    { name: 'heroVideoUrl', type: 'text', admin: { description: 'Optional hero video (muted autoplay loop).' } },
    { name: 'heroCaption', type: 'text' },

    // ─── Rich content ────────────────────────────────────────────────────
    {
      name: 'content',
      type: 'richText',
      required: true,
      editor: lexicalEditor({
        features: ({ defaultFeatures }) => [
          ...defaultFeatures,
          HeadingFeature({ enabledHeadingSizes: ['h1', 'h2', 'h3', 'h4'] }),
          LinkFeature({ enabledCollections: ['posts'] }),
          UploadFeature({ collections: { media: { fields: [{ name: 'caption', type: 'text' }] } } }),
          InlineCodeFeature(),
          HorizontalRuleFeature(),
          BlocksFeature({
            blocks: [
              PullQuoteBlock,
              ImageGalleryBlock,
              VideoEmbedBlock,
              StatBlockItem,
              EventCalloutBlock,
              AppCtaBlock,
              NewsletterCtaBlock,
              RelatedPostsBlock,
              TimelineBlock,
              FaqBlock,
              DividerBlock,
              SideNoteBlock,
              SponsoredDisclosureBlock,
            ],
          }),
        ],
      }),
    },
    lexicalHTMLField({ htmlFieldName: 'contentHtml', lexicalFieldName: 'content', storeInDB: true }),

    // ─── Taxonomy ────────────────────────────────────────────────────────
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'tags',
      type: 'array',
      admin: { position: 'sidebar' },
      fields: [{ name: 'tag', type: 'text', required: true }],
    },

    // ─── Authorship ─────────────────────────────────────────────────────
    // Primary byline — shown as "By Alice Kim" in article header.
    {
      name: 'authors',
      type: 'relationship',
      relationTo: 'authors',
      hasMany: true,
      admin: { position: 'sidebar', description: 'Primary byline ("By …")' },
    },
    // Contributors — NYT-style secondary credits shown beneath the byline.
    // Each entry carries a role label: "Photographs by", "Video by", "Reporting by", etc.
    {
      name: 'contributors',
      type: 'array',
      admin: { position: 'sidebar', description: 'Secondary credits shown beneath the byline ("Photographs by …")' },
      fields: [
        {
          name: 'author',
          type: 'relationship',
          relationTo: 'authors',
          required: true,
        },
        {
          name: 'role',
          type: 'text',
          required: true,
          admin: { description: 'e.g. "Photographs by", "Video by", "Reporting by", "Edited by"' },
        },
      ],
    },

    // ─── Editorial flags ─────────────────────────────────────────────────
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Pin to hero / featured slot on index.' },
    },
    {
      name: 'editorsPick',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: "Show in Editor's Picks rail." },
    },
    {
      name: 'trending',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Show in Trending rail.' },
    },
    {
      name: 'readTime',
      type: 'number',
      admin: {
        position: 'sidebar',
        description: 'Estimated read time in minutes. Auto-calculated from content on save.',
        readOnly: false,
      },
    },

    // ─── Related posts ───────────────────────────────────────────────────
    {
      name: 'relatedPosts',
      type: 'relationship',
      relationTo: 'posts',
      hasMany: true,
      maxDepth: 1,
      admin: { position: 'sidebar' },
    },

    // ─── Dates ───────────────────────────────────────────────────────────
    {
      name: 'publishedAt',
      type: 'date',
      index: true,
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'updatedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true },
    },

    // ─── SEO / OG ────────────────────────────────────────────────────────
    {
      type: 'group',
      name: 'seo',
      label: 'SEO & Open Graph',
      fields: [
        { name: 'title', type: 'text', admin: { description: 'Defaults to post title.' } },
        { name: 'description', type: 'textarea', admin: { description: 'Defaults to excerpt.' } },
        { name: 'ogImage', type: 'upload', relationTo: 'media', admin: { description: 'OG image (1200×630). Defaults to heroImage.' } },
        { name: 'canonicalUrl', type: 'text', admin: { description: 'Canonical URL override.' } },
        { name: 'noIndex', type: 'checkbox', defaultValue: false },
        { name: 'structuredData', type: 'json', admin: { description: 'Raw JSON-LD override (merged with auto-generated Article schema).' } },
      ],
    },

    // ─── Legacy SEO group (kept for backward compat) ─────────────────────
    {
      type: 'group',
      name: 'meta',
      label: 'Meta (legacy)',
      admin: { condition: () => false },
      fields: [
        { name: 'title', type: 'text' },
        { name: 'description', type: 'textarea' },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },

    // ─── Legacy coverImage (kept for existing data) ───────────────────────
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
      admin: { condition: () => false },
    },
  ],
}
