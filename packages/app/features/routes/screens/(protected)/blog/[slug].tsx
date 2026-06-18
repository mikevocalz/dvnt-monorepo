import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Share2 } from "lucide-react-native";
import { BlogContent } from "@dvnt/app/components/blog/BlogContent";
import { useBlogPost } from "@dvnt/app/lib/hooks/use-blog";
import {
  BLOG_ORIGIN,
  blogByline,
  blogDate,
  blogMediaUrl,
} from "@dvnt/app/lib/api/blog";

const C = {
  bg: "#000",
  fg: "#f5f5f4",
  muted: "#a3a3a3",
  faint: "#737373",
  cyan: "#3FDCFF",
  purple: "#C084FC",
  hairline: "rgba(255,255,255,0.10)",
};

export default function BlogPostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: post, isLoading, isError, refetch } = useBlogPost(slug);

  const hero = blogMediaUrl(post?.heroImage, "full");
  const accent = post?.categories?.[0]?.accentColor || C.cyan;
  const webUrl = post ? `${BLOG_ORIGIN}/posts/${post.slug}` : BLOG_ORIGIN;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Floating header */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingTop: insets.top + 4,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        pointerEvents="box-none"
      >
        <RoundButton onPress={() => router.back()} label="Go back">
          <ChevronLeft size={24} color="#fff" />
        </RoundButton>
        {post ? (
          <RoundButton onPress={() => Linking.openURL(webUrl).catch(() => {})} label="Open on web">
            <Share2 size={20} color="#fff" />
          </RoundButton>
        ) : null}
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : isError || !post ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: C.fg, fontSize: 18, fontWeight: "700" }}>Post not found</Text>
          <Text style={{ color: C.muted, fontSize: 14, marginTop: 6, textAlign: "center" }}>
            This story may have been unpublished or moved.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={{ marginTop: 18, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: "#8A40CF" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
          showsVerticalScrollIndicator={false}
        >
          {hero ? (
            <Image
              source={{ uri: hero }}
              style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: "#111" }}
              contentFit="cover"
            />
          ) : (
            <View style={{ height: insets.top + 56 }} />
          )}

          <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
            {post.eyebrow || post.categories[0] ? (
              <Text
                style={{
                  color: accent,
                  fontSize: 12,
                  fontWeight: "800",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {post.eyebrow || post.categories[0]?.title}
              </Text>
            ) : null}

            <Text style={{ color: C.fg, fontSize: 30, fontWeight: "900", lineHeight: 38 }}>
              {post.title}
            </Text>

            {post.excerpt ? (
              <Text style={{ color: C.muted, fontSize: 17, lineHeight: 25, marginTop: 12 }}>
                {post.excerpt}
              </Text>
            ) : null}

            {/* Byline */}
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18, gap: 10 }}>
              {post.authors[0]?.avatar ? (
                <Image
                  source={{ uri: blogMediaUrl(post.authors[0].avatar, "thumbnail") }}
                  style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#222" }}
                  contentFit="cover"
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.fg, fontSize: 14, fontWeight: "700" }}>
                  {blogByline(post.authors) || "DVNT"}
                </Text>
                <Text style={{ color: C.faint, fontSize: 12, marginTop: 1 }}>
                  {[blogDate(post.publishedAt), post.readTime ? `${post.readTime} min read` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: C.hairline, marginVertical: 22 }} />

            {/* Body */}
            <BlogContent content={post.content} />

            {post.heroCaption ? (
              <Text style={{ color: C.faint, fontSize: 13, marginTop: 8, fontStyle: "italic" }}>
                {post.heroCaption}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function RoundButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.5)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
      }}
    >
      {children}
    </Pressable>
  );
}
