// src/collections/Categories.ts — editorial taxonomy with accent tokens and
// featured image for cinematic category hero treatment.
import type { CollectionConfig } from 'payload'
import { isAdminPlus } from '../access/roles'
import { slugField } from '../fields/slug'

export const Categories: CollectionConfig = {
  slug: 'categories',
  dbName: 'categories',
  access: { read: () => true, create: isAdminPlus, update: isAdminPlus, delete: isAdminPlus },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'order'] },
  fields: [
    { name: 'title', type: 'text', required: true },
    ...slugField('title'),
    { name: 'description', type: 'textarea' },
    {
      name: 'accentColor',
      type: 'text',
      admin: {
        description: 'Hex or CSS color token for the category accent (e.g. #FF5BFC, #3FDCFF).',
      },
    },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    {
      name: 'order',
      type: 'number',
      defaultValue: 99,
      admin: { description: 'Lower = displayed first in the category rail.' },
    },
  ],
}
