import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchBlogCategories,
  fetchBlogPostBySlug,
  fetchBlogPosts,
  type BlogPostsPage,
} from "@dvnt/app/lib/api/blog";

export const blogKeys = {
  all: ["blog"] as const,
  posts: (category?: string) => ["blog", "posts", category ?? "all"] as const,
  post: (slug: string) => ["blog", "post", slug] as const,
  categories: () => ["blog", "categories"] as const,
};

const LIMIT = 12;

/** Paginated published posts, optionally filtered by category slug. */
export function useBlogPosts(category?: string) {
  return useInfiniteQuery({
    queryKey: blogKeys.posts(category),
    queryFn: ({ pageParam }) =>
      fetchBlogPosts({ page: pageParam as number, limit: LIMIT, category }),
    initialPageParam: 1,
    getNextPageParam: (last: BlogPostsPage) =>
      last.hasNextPage ? last.page + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });
}

/** A single post by slug, for the reader screen. */
export function useBlogPost(slug: string | undefined) {
  return useQuery({
    queryKey: blogKeys.post(slug ?? ""),
    queryFn: () => fetchBlogPostBySlug(slug as string),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

/** Category rail for the index filter. */
export function useBlogCategories() {
  return useQuery({
    queryKey: blogKeys.categories(),
    queryFn: fetchBlogCategories,
    staleTime: 30 * 60 * 1000,
  });
}
