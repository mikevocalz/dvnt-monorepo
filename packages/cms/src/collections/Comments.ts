// src/collections/Comments.ts
// User comments on blog posts. Authored by DVNT app members (not admin users),
// authenticated via the app's Supabase/Better Auth session (the blog's comment
// endpoint). Auto-published, post-moderated, fully threaded.
//
// Moderation contract (enforced in hooks/commentGuards.ts + access below):
//   - banned / suspended members CANNOT create comments
//   - shadow_banned members' comments are visible ONLY to themselves
//   - removed comments are hidden from the public but kept for audit
//   - every comment is reportable into the existing `reports` queue
import type { CollectionConfig } from 'payload'
import { canModerate, isAtLeast } from '../access/roles'
import { blockBannedComment, stampCommentAuthor } from './hooks/commentGuards'
import { createCommentEndpoint, reportCommentEndpoint } from '../endpoints/createComment'

export const COMMENT_STATUSES = ['visible', 'removed'] as const

export const Comments: CollectionConfig = {
  slug: 'comments',
  dbName: 'comments',
  access: {
    // Public read returns visible comments. Shadow-ban filtering and own-comment
    // visibility are applied at the API layer (lib/comments on the blog) because
    // the public reader is unauthenticated to Payload; admins see everything.
    read: ({ req }) => {
      if (req.user) return true // admin users (moderators+) see all
      return { status: { equals: 'visible' } }
    },
    // Creation happens through the blog's comment endpoint using a service token
    // AFTER it has verified the app session + moderation state. Direct public
    // create is closed; the endpoint sets overrideAccess.
    create: () => false,
    update: canModerate, // mods flip status to removed
    delete: canModerate,
  },
  admin: {
    group: 'Content',
    description: 'Blog comments and moderation status.',
    useAsTitle: 'id',
    defaultColumns: ['post', 'authorMember', 'status', 'createdAt'],
  },
  endpoints: [createCommentEndpoint, reportCommentEndpoint],
  hooks: {
    beforeValidate: [stampCommentAuthor], // normalize author + parent
    beforeOperation: [blockBannedComment], // hard gate on member status
    afterChange: [
      async ({ doc, req, operation }) => {
        // Top-level comment: threadRoot is itself. Backfill once after create.
        if (operation === 'create' && !doc.parent && !doc.threadRoot) {
          await req.payload
            .update({ collection: 'comments', id: doc.id, overrideAccess: true, data: { threadRoot: doc.id } })
            .catch(() => {})
        }
        return doc
      },
    ],
  },
  fields: [
    { name: 'post', type: 'relationship', relationTo: 'posts', required: true, index: true },
    { name: 'authorMember', type: 'relationship', relationTo: 'members', required: true, index: true },
    // Parent comment for nested threads; null/absent = top-level.
    { name: 'parent', type: 'relationship', relationTo: 'comments', index: true },
    // Materialized thread root + depth so the blog can fetch a whole thread in
    // one query and render nesting without recursive round-trips.
    {
      name: 'threadRoot',
      type: 'relationship',
      relationTo: 'comments',
      index: true,
      admin: { readOnly: true, description: 'Top-level ancestor; equals self for roots.' },
    },
    { name: 'depth', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'body', type: 'textarea', required: true, maxLength: 4000 },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'visible',
      index: true,
      options: COMMENT_STATUSES.map((s) => ({ label: s, value: s })),
      // Field-level access takes a FieldAccess (not the collection Access).
      access: { update: ({ req }) => isAtLeast(req, 'super_admin', 'admin', 'moderator') },
    },
    // Set true when authored by a shadow_banned member: publicly filtered, but
    // returned to the author themselves so they don't notice the shadow ban.
    {
      name: 'shadowed',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: { readOnly: true, position: 'sidebar' },
    },
    { name: 'editedAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
  ],
}
