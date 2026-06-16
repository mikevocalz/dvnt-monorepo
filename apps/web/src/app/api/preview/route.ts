// src/app/api/preview/route.ts — enable Next draft mode for Payload live preview.
// Payload's livePreview.url (Posts collection in web-vite) points here; we verify
// the shared secret, enable draft mode, and redirect to the post so
// getPostBySlug fetches the draft version.
import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  const slug = searchParams.get('slug')
  if (secret !== process.env.PREVIEW_SECRET || !slug) {
    return new Response('Invalid preview request', { status: 401 })
  }
  ;(await draftMode()).enable()
  redirect(`/${slug}`)
}
