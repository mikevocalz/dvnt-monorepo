// src/collections/Media.ts — uploads for cover images / inline images.
import type { CollectionConfig } from 'payload'
import { isAdminPlus } from '../access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  dbName: 'media',
  upload: {
    // Configure your storage adapter (S3 / Supabase Storage) in payload.config.
    mimeTypes: ['image/*'],
    imageSizes: [
      { name: 'thumbnail', width: 400 },
      { name: 'card', width: 768 },
      { name: 'og', width: 1200, height: 630 },
    ],
  },
  access: { read: () => true, create: isAdminPlus, update: isAdminPlus, delete: isAdminPlus },
  fields: [
    { name: 'alt', type: 'text', required: true },
    { name: 'creditText', type: 'text' }, // for SEO structured data
  ],
}
