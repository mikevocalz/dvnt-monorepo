import type { MetadataRoute } from "next";

const BASE = (
  process.env.NEXT_PUBLIC_SERVER_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://dvnt-blog.vercel.app"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep the admin, internal API, and console out of search results.
        disallow: ["/admin", "/payload-api", "/console", "/api"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
