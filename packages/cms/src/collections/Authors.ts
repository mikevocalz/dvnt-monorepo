// src/collections/Authors.ts — editorial bylines for blog posts.
// Separate from AdminUsers (CMS auth); an Author is a public-facing editorial
// identity (writer, contributor, photographer, etc.). Admins/editors manage them.
import type { CollectionConfig } from 'payload'
import { isAdminPlus } from '../access/roles'
import { slugField } from '../fields/slug'

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
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'role'],
    listSearchableFields: ['name', 'email'],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    ...slugField('name'),
    { name: 'email', type: 'email', admin: { position: 'sidebar' } },
    { name: 'role', type: 'text', admin: { description: 'e.g. Editor-at-Large, Photographer, Staff Writer' } },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'upload', relationTo: 'media' },
    {
      name: 'socials',
      type: 'group',
      fields: [
        { name: 'instagram', type: 'text' },
        { name: 'twitter', type: 'text' },
        { name: 'tiktok', type: 'text' },
        { name: 'website', type: 'text' },
      ],
    },
    { name: 'profileUrl', type: 'text', admin: { description: 'Link to author profile page if external' } },
  ],
}
