// src/app/blog.index.tsx — DVNT editorial blog index. Route: /blog
// SSR loader fetches data server-side (plain fetch, SSR-safe). The actual render
// uses react-native(-web) which CANNOT evaluate in this TanStack-Start/RSC/Vite
// SSR runtime, so the view is lazy-imported and gated behind a mount effect —
// it only loads in the browser. (Same pattern as the dashboard route.)
import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import {
  fetchPostsIndex,
  fetchFeaturedPost,
  fetchEditorsPicks,
  fetchTrending,
  fetchCategories,
} from '../blog/api'

const BlogIndexView = lazy(() =>
  import('../blog/views/BlogIndexView').then((m) => ({ default: m.BlogIndexView })),
)

export const Route = createFileRoute('/blog/')({
  loader: async () => {
    const [featured, editorsPicks, trending, categories, latest] = await Promise.all([
      fetchFeaturedPost(),
      fetchEditorsPicks(4),
      fetchTrending(6),
      fetchCategories(),
      fetchPostsIndex({ limit: 12 }),
    ])
    return { featured, editorsPicks, trending, categories, latest }
  },
  head: () => ({
    meta: [
      { title: 'DVNT Magazine — Culture, Events & Editorial' },
      { name: 'description', content: 'The DVNT editorial platform. Premium nightlife culture, event guides, creator features, and more.' },
      { property: 'og:title', content: 'DVNT Magazine' },
    ],
  }),
  component: BlogIndexRoute,
})

function BlogIndexRoute() {
  const data = Route.useLoaderData()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <BlogIndexView {...data} />
    </Suspense>
  )
}
