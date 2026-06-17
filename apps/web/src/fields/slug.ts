// src/fields/slug.ts — slug field + auto-format from a source field.
// Mirrors the official Payload website template's slug pattern: a text field
// with a beforeValidate hook that slugifies the source unless manually locked.
import type { Field } from 'payload'

const slugify = (val: string) =>
  val
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const slugField = (sourceField = 'title'): Field[] => [
  {
    name: 'slug',
    type: 'text',
    index: true,
    unique: true,
    admin: { position: 'sidebar' },
    hooks: {
      beforeValidate: [
        ({ value, data }) => {
          if (typeof value === 'string' && value.length) return slugify(value)
          const src = data?.[sourceField]
          return typeof src === 'string' ? slugify(src) : value
        },
      ],
    },
  },
]
