// src/lib/blog-api.ts — the magazine pages' data API. A thin façade over
// `posts.ts` (the Payload REST client) using the blog's own naming. Kept as a
// separate module so the page/components import a stable `fetch*` surface.
export {
  mediaUrl,
  formatByline,
  formatDate,
  formatDateShort,
  getFeaturedPost as fetchFeaturedPost,
  getEditorsPicks as fetchEditorsPicks,
  getTrending as fetchTrending,
  getCategories as fetchCategories,
  getLatestPosts as fetchLatestPosts,
  getPostBySlug as fetchPostBySlug,
  getAllSlugs as fetchAllSlugs,
  getPostsPage as fetchPostsIndex,
} from './posts'

export type {
  Post as BlogPostCard,
  PostCategory as BlogCategory,
  PostAuthor,
  PostMedia,
  PostContributor,
} from './posts'
