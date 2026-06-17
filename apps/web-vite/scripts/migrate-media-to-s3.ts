/**
 * One-time migration: upload the legacy static blog media
 * (apps/web/public/blog-media/*) into the Supabase Storage `cms-media` bucket,
 * keyed by filename — which is exactly what Payload's s3Storage adapter expects
 * (payload.media rows reference these filenames). Run AFTER setting the S3 env:
 *
 *   pnpm --filter web-vite migrate:media
 *
 * Idempotent: re-running just overwrites. Reads S3_* from .env (dotenv).
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const MEDIA_DIR = path.resolve(dirname, '../../web/public/blog-media')

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
}

async function main() {
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 not configured — set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY in .env first.',
    )
  }

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  })

  const files = readdirSync(MEDIA_DIR).filter((f) => !f.startsWith('.'))
  console.log(`Uploading ${files.length} files from ${MEDIA_DIR} → ${bucket}`)

  let ok = 0
  for (const filename of files) {
    const Body = readFileSync(path.join(MEDIA_DIR, filename))
    const ext = path.extname(filename).toLowerCase()
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: filename,
        Body,
        ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        ACL: 'public-read',
      }),
    )
    ok++
    console.log(`  ✓ ${filename}`)
  }
  console.log(`Done — ${ok}/${files.length} uploaded to ${bucket}.`)
}

main().catch((e) => {
  console.error('[migrate-media-to-s3] failed:', e?.message ?? e)
  process.exit(1)
})
