// src/collections/Authors.ts — editorial bylines for blog posts.
// An Author is a public-facing editorial identity (the "About the author" card:
// title, bio, socials), but it is ALWAYS backed by a real user — a moderator in
// `admin-users`. Blog authors come from moderators (who are users), so every
// author MUST link to one (`user`, enforced below). Name + avatar SYNC from that
// linked user at save time, so the byline is the user's identity; author-level
// fields act as optional editorial overrides (e.g. a pen name, a staff title).
import type { CollectionConfig, CollectionBeforeChangeHook } from 'payload'
import { isAdminPlus } from '../access/roles'
import { slugField } from '../fields/slug'

// Pull the byline identity from the linked moderator/user. Avatar always mirrors
// the user's app avatar; name defaults to the user's name unless the author set
// an explicit one (pen name / editorial byline).
const syncAuthorFromUser: CollectionBeforeChangeHook = async ({ data, req }) => {
  const raw = (data as any)?.user
  if (raw == null) return data
  const userId = typeof raw === 'object' ? (raw.value ?? raw.id) : raw
  if (userId == null) return data
  try {
    const u = await req.payload.findByID({
      collection: 'admin-users',
      id: userId,
      depth: 0,
      overrideAccess: true,
    })
    if (u) {
      if ((u as any).avatarUrl) (data as any).avatarUrl = (u as any).avatarUrl
      if (!(data as any).name?.trim() && (u as any).name) (data as any).name = (u as any).name
    }
  } catch {
    /* a bad link shouldn't block saving; validate() already guards presence */
  }
  return data
}

export const Authors: CollectionConfig = {
  slug: 'authors',
  dbName: 'authors',
  access: {
    read: () => true,
    create: isAdminPlus,
    update: isAdminPlus,
    delete: isAdminPlus,
  },
  admin: {
    group: 'Content',
    description: 'Blog bylines (linked to staff users).',
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'role'],
    listSearchableFields: ['name', 'email'],
  },
  hooks: {
    beforeChange: [syncAuthorFromUser],
  },
  fields: [
    // The user (moderator) this byline belongs to. Required — every blog author
    // is a real user. Enforced via validate (not a DB NOT NULL) so the column
    // stays nullable and the change migrates cleanly onto existing author rows.
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'admin-users',
      // required at the application layer; see note above.
      validate: (value: unknown) => (value ? true : 'An author must be linked to a user (moderator).'),
      admin: {
        position: 'sidebar',
        description: 'The moderator/user this byline belongs to. Name + avatar sync from them.',
      },
    },
    { name: 'name', type: 'text', required: true, admin: { description: 'Defaults to the linked user; set to override (pen name / byline).' } },
    ...slugField('name'),
    { name: 'email', type: 'email', admin: { position: 'sidebar' } },
    { name: 'role', type: 'text', admin: { description: 'e.g. Editor-at-Large, Photographer, Staff Writer' } },
    { name: 'bio', type: 'textarea' },
    // Editorial avatar override (upload). When empty the card uses `avatarUrl`,
    // synced from the linked user below.
    { name: 'avatar', type: 'upload', relationTo: 'media', admin: { description: 'Optional override; defaults to the linked user’s avatar.' } },
    // Synced from the linked user's app avatar at save time (read-only).
    {
      name: 'avatarUrl',
      type: 'text',
      admin: { readOnly: true, position: 'sidebar', description: 'Synced from the linked user’s avatar.' },
    },
    {
      name: 'socials',
      type: 'group',
      admin: { description: 'Shown as links on the author byline. Handles can include or omit the leading @.' },
      fields: [
        { name: 'instagram', type: 'text', admin: { description: 'Handle, e.g. dvnt or @dvnt' } },
        { name: 'twitter', type: 'text', label: 'Twitter / X', admin: { description: 'Handle, e.g. dvnt' } },
        { name: 'tiktok', type: 'text', admin: { description: 'Handle, e.g. dvnt' } },
        { name: 'onlyfans', type: 'text', label: 'OnlyFans', admin: { description: 'Handle, e.g. dvnt' } },
        { name: 'website', type: 'text', label: 'Website / external link', admin: { description: 'Full URL incl. https://' } },
      ],
    },
    { name: 'profileUrl', type: 'text', admin: { description: 'Link to author profile page if external' } },
  ],
}
