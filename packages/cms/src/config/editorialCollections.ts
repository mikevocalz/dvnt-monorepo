import type { CollectionConfig } from 'payload'
import { EditorialChannels } from '../collections/EditorialChannels'
import { EditorialQueue } from '../collections/EditorialQueue'

/**
 * Register the unfinished editorial workspace only after its tables AND shared
 * Payload relationship columns have been provisioned with a reviewed migration.
 * Registering it early makes Payload's document-lock query reference nonexistent
 * columns even when opening an unrelated blog post. Keep blog locking enabled.
 * This flag never runs a migration or enables schema push.
 */
export const getOptionalEditorialCollections = (ready?: string): CollectionConfig[] =>
  ready === 'true' ? [EditorialChannels, EditorialQueue] : []
