import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { blogByline, blogDate, blogMediaUrl, type BlogPost } from "@dvnt/app/lib/api/blog";

const C = {
  fg: "#f5f5f4",
  muted: "#a3a3a3",
  faint: "#737373",
  cyan: "#3FDCFF",
  hairline: "rgba(255,255,255,0.08)",
  panel: "rgba(28,28,28,0.6)",
};

/** A magazine-style card for the blog index list. */
export function BlogPostCard({ post }: { post: BlogPost }) {
  const router = useRouter();
  const hero = blogMediaUrl(post.heroImage, "card");
  const accent = post.categories[0]?.accentColor || C.cyan;

  return (
    <Pressable
      onPress={() => router.push(`/(protected)/blog/${post.slug}` as never)}
      style={{
        backgroundColor: C.panel,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: C.hairline,
        overflow: "hidden",
        marginBottom: 16,
      }}
      accessibilityRole="button"
      accessibilityLabel={`Read: ${post.title}`}
    >
      {hero ? (
        <Image
          source={{ uri: hero }}
          style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "#111" }}
          contentFit="cover"
          transition={200}
        />
      ) : null}
      <View style={{ padding: 16 }}>
        {post.eyebrow || post.categories[0] ? (
          <Text
            style={{
              color: accent,
              fontSize: 12,
              fontWeight: "800",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {post.eyebrow || post.categories[0]?.title}
          </Text>
        ) : null}
        <Text style={{ color: C.fg, fontSize: 20, fontWeight: "800", lineHeight: 26 }}>
          {post.title}
        </Text>
        {post.excerpt ? (
          <Text style={{ color: C.muted, fontSize: 14, lineHeight: 20, marginTop: 6 }} numberOfLines={3}>
            {post.excerpt}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 }}>
          <Text style={{ color: C.faint, fontSize: 12 }} numberOfLines={1}>
            {[blogByline(post.authors), blogDate(post.publishedAt)].filter(Boolean).join(" · ")}
          </Text>
          {post.readTime ? (
            <Text style={{ color: C.faint, fontSize: 12 }}>· {post.readTime} min</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
