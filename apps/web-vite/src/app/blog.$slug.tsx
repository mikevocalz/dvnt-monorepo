// src/app/blog.$slug.tsx — DVNT article detail. Route: /blog/:slug
// SSR loader + head are server-safe (plain fetch). The cinematic render uses
// react-native(-web), which CANNOT evaluate in this TanStack-Start/RSC/Vite SSR
// runtime, so the view is lazy-imported and gated behind a mount effect — it
// only loads in the browser. (Same pattern as the dashboard + blog index.)
import { createFileRoute, notFound } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchPostBySlug, fetchLatestPosts, mediaUrl } from '../blog/api'

const PostDetailView = lazy(() =>
  import('../blog/views/PostDetailView').then((m) => ({ default: m.PostDetailView })),
)
const PostNotFoundView = lazy(() =>
  import('../blog/views/PostDetailView').then((m) => ({ default: m.PostNotFoundView })),
)

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const [post, latest] = await Promise.all([
      fetchPostBySlug(params.slug),
      fetchLatestPosts(4, params.slug),
    ])
    if (!post) throw notFound()
    return { post, latest }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { post } = loaderData
    const title = post.seo?.title ?? post.title
    const description = post.seo?.description ?? post.excerpt ?? ''
    const image = post.seo?.ogImage
      ? mediaUrl(post.seo.ogImage, 'og')
      : post.heroImage
        ? mediaUrl(post.heroImage, 'og')
        : ''
    return {
      meta: [
        { title: `${title} — DVNT Magazine` },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(image ? [{ property: 'og:image', content: image }] : []),
        { property: 'og:type', content: 'article' },
        ...(post.seo?.canonicalUrl ? [{ tagName: 'link', rel: 'canonical', href: post.seo.canonicalUrl }] : []),
      ],
    }
  },
  component: PostDetailRoute,
  notFoundComponent: NotFoundRoute,
})

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return <Suspense fallback={null}>{children}</Suspense>
}

function PostDetailRoute() {
  const data = Route.useLoaderData()
  return (
    <ClientOnly>
      <PostDetailView post={data.post} latest={data.latest} />
    </ClientOnly>
  )
}

function NotFoundRoute() {
  return (
    <ClientOnly>
      <PostNotFoundView />
    </ClientOnly>
  )
}
