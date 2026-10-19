// Public editorial profiles backed by an existing CMS staff account. The same
// account is used by local admin sign-in and the Better Auth staff bridge.
import type { CollectionConfig } from 'payload'
import { slugField } from '../fields/slug'
import { authorStaffAccess, authorEditorAccess, updateAuthorAccess,
  authorsProfileEndpoint, authorAccountsEndpoint, accountAuthorProfileEndpoint, hydrateAuthorPhoto, prepareAuthorProfile } from '../authors/profiles'

export const Authors: CollectionConfig = {
  slug: 'authors',
  dbName: 'authors',
  access: {
    read: () => true,
    create: authorStaffAccess,
    update: updateAuthorAccess,
    delete: authorEditorAccess,
  },
  admin: {
    group: 'Content',
    description: 'Your public writer profile. Changes appear on every article using this byline.',
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'role'],
    listSearchableFields: ['name', 'email'],
  },
  hooks: {
    beforeChange: [prepareAuthorProfile],
    beforeRead: [hydrateAuthorPhoto],
  },
  endpoints: [authorsProfileEndpoint, authorAccountsEndpoint, accountAuthorProfileEndpoint],
  fields: [
    // Reuse the existing nullable relationship. New profiles require an
    // account in the write hook; historical unlinked bylines stay untouched.
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'admin-users',
      // New profiles require a real account in the hook. Legacy rows remain
      // nullable and are never claimed automatically. Keep the existing schema.
      access: { create: authorEditorAccess, update: authorEditorAccess, read: authorStaffAccess },
      admin: {
        position: 'sidebar',
        description: 'Your signed-in staff account is linked automatically. Editors can link an unclaimed profile. An established account link stays fixed.',
      },
    },
    { name: 'name', type: 'text', required: true, admin: { description: 'Defaults to the linked user; set to override (pen name / byline).' } },
    ...slugField('name'),
    { name: 'email', type: 'email', access: { read: authorStaffAccess }, admin: { position: 'sidebar', description: 'Editorial contact email, visible only to signed-in staff.' } },
    { name: 'role', type: 'text', admin: { description: 'e.g. Editor-at-Large, Photographer, Staff Writer' } },
    { name: 'bio', type: 'textarea' },
    // Editorial avatar override (upload). When empty the card uses `avatarUrl`,
    // synced from the linked user below.
    { name: 'avatar', type: 'upload', relationTo: 'media', admin: { description: 'Optional override; defaults to the linked user’s avatar.' } },
    // Synced from the linked user's app avatar at save time (read-only).
    {
      name: 'avatarUrl',
      type: 'text',
      access: { create: () => false, update: () => false },
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
