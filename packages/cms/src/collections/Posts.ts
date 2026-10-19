// src/collections/Posts.ts — editorial blog posts with full magazine-grade
// schema: cinematic hero, rich content blocks, editorial flags, SEO/OG, drafts.
import type { CollectionConfig, Block, Field } from 'payload'
import type { AdminUser } from '../payload-types'
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
import { canModerate } from '../access/roles'
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

// Unnamed groups are presentation-only: existing fields keep their exact database
// and API paths. All editable sections stay visible in one native Payload form.
const postSection = (label: string, description: string, fields: Field[]): Field => ({
  type: 'group',
  label,
  admin: { description, className: 'dvnt-post-section' },
  fields: fields.map((field) => ({
    ...field,
    admin: { ...field.admin, position: undefined },
  }) as Field),
})

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
    // Moderators+ can author posts; admins+ edit/delete anything, while a
    // moderator is scoped to the posts they created (own-blog editing).
    create: canModerate,
    update: ({ req }) => {
      const role = (req.user as AdminUser | null)?.role
      if (role === 'super_admin' || role === 'admin') return true
      if (role === 'moderator') return { createdBy: { equals: req.user?.id } }
      return false
    },
    delete: ({ req }) => {
      const role = (req.user as AdminUser | null)?.role
      if (role === 'super_admin' || role === 'admin') return true
      if (role === 'moderator') return { createdBy: { equals: req.user?.id } }
      return false
    },
    readVersions: canModerate,
  },
  admin: {
    group: 'Content',
    description: 'Edit the entire blog article below: story, media, credits, discovery and SEO. Save Draft or Publish applies to this whole page.',
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
      ({ data, operation, req }) => {
        if (operation === 'create' || operation === 'update') {
          if (data._status === 'published' && !data.publishedAt)
            data.publishedAt = new Date().toISOString()
          if (!data.readTime && data.contentHtml) {
            const words = (data.contentHtml as string).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
            data.readTime = Math.max(1, Math.ceil(words / 238))
          }
          // Stamp the creating staff member so a moderator can be scoped to
          // editing only their own posts (see access.update).
          if (operation === 'create' && req?.user && !data.createdBy) data.createdBy = req.user.id
        }
        return data
      },
    ],
  },
  fields: [
    // ─── Core identity ───────────────────────────────────────────────────
    postSection('Story details', 'Title, URL and the summary readers see before opening the article.', [
      { name: 'title', type: 'text', required: true },
      ...slugField('title'),
      { name: 'excerpt', type: 'textarea', admin: { description: 'Dek / article summary shown in cards and hero.' } },
      { name: 'eyebrow', type: 'text', admin: { description: 'Short label above the title (e.g. "Culture", "Breaking")' } },

    ]),

    // ─── Hero media ──────────────────────────────────────────────────────
    postSection('Hero media', 'Choose the lead image or video and its caption.', [
      { name: 'heroImage', type: 'upload', relationTo: 'media', admin: { description: 'Cinematic hero — 16:9 or wider preferred.' } },
      { name: 'heroVideoUrl', type: 'text', admin: { description: 'Optional hero video (muted autoplay loop).' } },
      { name: 'heroCaption', type: 'text' },

    ]),

    // ─── Rich content ────────────────────────────────────────────────────
    postSection('Article content', 'Write the full story and insert galleries, videos, quotes, FAQs and other content blocks.', [
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

    ]),

    // ─── Taxonomy ────────────────────────────────────────────────────────
    postSection('Categories & tags', 'Organize the article for discovery.', [
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

    ]),

    // ─── Authorship ─────────────────────────────────────────────────────
    postSection('Authors & contributors', 'Set the byline and secondary credits. The creating staff member remains read-only.', [
      // Primary byline — shown as "By Alice Kim" (and co-authors) in the article
      // header. hasMany = NYT-style multi-writer credit, picked from a dropdown.
      {
        name: 'authors',
        type: 'relationship',
        relationTo: 'authors',
        hasMany: true,
        admin: { position: 'sidebar', description: 'Primary byline — add co-authors here ("By A, B & C")' },
      },
      // Which staff member created this post (auto-set). Drives moderator
      // own-post edit scoping; read-only in the UI.
      {
        name: 'createdBy',
        type: 'relationship',
        relationTo: 'admin-users',
        access: { update: () => false },
        admin: { position: 'sidebar', readOnly: true, description: 'Staff member who created this post.' },
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

    ]),

    // ─── Editorial flags ─────────────────────────────────────────────────
    postSection('Editorial placement', 'Choose where the article appears and review its reading time.', [
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

    ]),

    // ─── Related posts ───────────────────────────────────────────────────
    postSection('Related posts', 'Choose other articles to recommend to readers.', [
      {
        name: 'relatedPosts',
        type: 'relationship',
        relationTo: 'posts',
        hasMany: true,
        maxDepth: 1,
        admin: { position: 'sidebar' },
      },

    ]),

    // ─── Dates ───────────────────────────────────────────────────────────
    postSection('Publication dates', 'Set the publication date. The last-updated timestamp is managed automatically.', [
      {
        name: 'publishedAt',
        type: 'date',
        index: true,
        admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
      },

    ]),

    // Payload detects built-in timestamps at the top level; keep this outside
    // presentation groups so sanitization does not inject a second updatedAt.
    { name: 'updatedAt', type: 'date', admin: { readOnly: true } },

    // ─── SEO / OG ────────────────────────────────────────────────────────
    postSection('SEO & sharing', 'Control search results, social previews and indexing.', [
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

    ]),

    // ─── Legacy SEO group (kept for backward compat) ─────────────────────
    postSection('Legacy fallbacks', 'Older articles may still use these values when the main hero or SEO fields are empty.', [
      {
        type: 'group',
        name: 'meta',
        label: 'Meta (legacy)',

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

      },
    ]),
  ],
}
