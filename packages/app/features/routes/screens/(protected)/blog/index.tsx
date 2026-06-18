import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, BookOpen } from "lucide-react-native";
import { BlogPostCard } from "@dvnt/app/components/blog/BlogPostCard";
import { useBlogCategories, useBlogPosts } from "@dvnt/app/lib/hooks/use-blog";
import type { BlogPost } from "@dvnt/app/lib/api/blog";

const C = {
  bg: "#000",
  fg: "#f5f5f4",
  muted: "#a3a3a3",
  faint: "#737373",
  cyan: "#3FDCFF",
  hairline: "rgba(255,255,255,0.10)",
  pill: "rgba(255,255,255,0.06)",
};

export default function BlogIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [category, setCategory] = useState<string | undefined>(undefined);

  const { data: categories = [] } = useBlogCategories();
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBlogPosts(category);

  const posts: BlogPost[] = useMemo(
    () => data?.pages.flatMap((p) => p.docs) ?? [],
    [data],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 12,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={26} color={C.fg} />
        </Pressable>
        <Text style={{ color: C.fg, fontSize: 22, fontWeight: "800" }}>Blog</Text>
      </View>

      {/* Category filter */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
        >
          <CategoryPill label="All" active={!category} onPress={() => setCategory(undefined)} />
          {categories.map((c) => (
            <CategoryPill
              key={c.id}
              label={c.title}
              accent={c.accentColor}
              active={category === c.slug}
              onPress={() => setCategory(c.slug)}
            />
          ))}
        </ScrollView>
      ) : null}

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : isError ? (
        <EmptyState
          title="Couldn't load the blog"
          subtitle="Check your connection and try again."
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <BlogPostCard post={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.cyan} />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState title="No posts yet" subtitle="Check back soon for new stories." />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={C.cyan} style={{ marginVertical: 20 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

function CategoryPill({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent?: string;
  onPress: () => void;
}) {
  const color = accent || C.cyan;
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? color : C.pill,
        borderWidth: 1,
        borderColor: active ? color : C.hairline,
      }}
    >
      <Text style={{ color: active ? "#000" : C.fg, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  title,
  subtitle,
  onRetry,
}: {
  title: string;
  subtitle: string;
  onRetry?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 80, paddingHorizontal: 32 }}>
      <BookOpen size={44} color={C.faint} />
      <Text style={{ color: C.fg, fontSize: 17, fontWeight: "700", marginTop: 16 }}>{title}</Text>
      <Text style={{ color: C.muted, fontSize: 14, marginTop: 6, textAlign: "center" }}>{subtitle}</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={{ marginTop: 18, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: "#8A40CF" }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
