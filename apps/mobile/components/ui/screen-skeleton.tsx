import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Skeleton, SkeletonCircle, SkeletonText } from "./skeleton";

type ScreenSkeletonVariant = "list" | "grid" | "detail" | "form";

interface ScreenSkeletonProps {
  /** Layout variant (default: "list") */
  variant?: ScreenSkeletonVariant;
  /** Number of placeholder rows for list/grid (default: 6) */
  rows?: number;
  /** Show a header bar skeleton (default: true) */
  showHeader?: boolean;
}

/**
 * Generic full-screen loading skeleton.
 * Drop-in replacement for ActivityIndicator-based loading states.
 *
 * Usage:
 *   import { ScreenSkeleton } from "@/components/ui/screen-skeleton";
 *   if (isLoading) return <ScreenSkeleton variant="list" />;
 */
export function ScreenSkeleton({
  variant = "list",
  rows = 6,
  showHeader = true,
}: ScreenSkeletonProps) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {showHeader && <HeaderSkeleton />}
      <View className="flex-1 px-4 pt-4">
        {variant === "list" && <ListSkeleton rows={rows} />}
        {variant === "grid" && <GridSkeleton rows={rows} />}
        {variant === "detail" && <DetailSkeleton />}
        {variant === "form" && <FormSkeleton rows={rows} />}
      </View>
    </SafeAreaView>
  );
}

function HeaderSkeleton() {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-border/30">
      <SkeletonCircle size={32} />
      <SkeletonText width={120} height={18} style={{ marginLeft: 12 }} />
    </View>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <View style={{ gap: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row items-center" style={{ gap: 12 }}>
          <SkeletonCircle size={48} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonText width={140} height={14} />
            <SkeletonText width={200} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

function GridSkeleton({ rows }: { rows: number }) {
  const gridRows = Math.ceil(rows / 3);
  return (
    <View style={{ gap: 4 }}>
      {Array.from({ length: gridRows }).map((_, i) => (
        <View key={i} className="flex-row" style={{ gap: 4 }}>
          {[0, 1, 2].map((j) => (
            <Skeleton
              key={j}
              style={{ flex: 1, aspectRatio: 1, borderRadius: 4 }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={{ gap: 16 }}>
      <Skeleton style={{ width: "100%", height: 240, borderRadius: 12 }} />
      <SkeletonText width={200} height={22} />
      <SkeletonText width={280} height={14} />
      <SkeletonText width={240} height={14} />
      <View style={{ height: 16 }} />
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <SkeletonCircle size={40} />
        <View style={{ gap: 4 }}>
          <SkeletonText width={100} height={14} />
          <SkeletonText width={60} height={12} />
        </View>
      </View>
    </View>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <View style={{ gap: 20 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ gap: 6 }}>
          <SkeletonText width={80} height={12} />
          <Skeleton style={{ width: "100%", height: 44, borderRadius: 10 }} />
        </View>
      ))}
    </View>
  );
}
