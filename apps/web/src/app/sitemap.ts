import type { MetadataRoute } from "next";
import { getAllSlugs, getCategories } from "@/lib/posts";

const BASE = (
  process.env.NEXT_PUBLIC_SERVER_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://dvnt-blog.vercel.app"
).replace(/\/$/, "");

// Blog routes exist to be found + shared (PROMPT 13 §2). Published posts + their
// taxonomy go in the sitemap; everything reads the in-process Payload Local API.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  let slugs: string[] = [];
  let cats: { slug: string }[] = [];
  try {
    [slugs, cats] = await Promise.all([getAllSlugs(), getCategories()]);
  } catch {
    /* DB unreachable at build → ship the static routes, skip dynamic */
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/events`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const posts: MetadataRoute.Sitemap = slugs.map((s) => ({
    url: `${BASE}/posts/${s}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const categories: MetadataRoute.Sitemap = cats.map((c) => ({
    url: `${BASE}/blog/category/${c.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...posts, ...categories];
}
