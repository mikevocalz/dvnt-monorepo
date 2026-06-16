import { View } from "react-native";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/skeleton";

/**
 * Skeleton for payment list screens (payment methods, purchases, refunds, payouts, etc.)
 * Mimics a list of card-like rows with icon, title, and subtitle.
 */
export function PaymentsListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View className="flex-1 bg-background px-4 pt-4" style={{ gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          className="bg-card rounded-2xl border border-border p-4"
          style={{ gap: 10 }}
        >
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <Skeleton
              style={{ width: 40, height: 40, borderRadius: 12 }}
            />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonText width={140} height={14} />
              <SkeletonText width={200} height={11} />
            </View>
            <SkeletonText width={60} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeleton for the host payments dashboard (balance cards + nav rows).
 */
export function HostPaymentsDashboardSkeleton() {
  return (
    <View className="flex-1 bg-background px-4 pt-4" style={{ gap: 16 }}>
      {/* Balance cards */}
      <View className="flex-row" style={{ gap: 12 }}>
        <Skeleton style={{ flex: 1, height: 88, borderRadius: 16 }} />
        <Skeleton style={{ flex: 1, height: 88, borderRadius: 16 }} />
      </View>
      <Skeleton style={{ width: "100%", height: 88, borderRadius: 16 }} />

      {/* Connect status */}
      <Skeleton style={{ width: "100%", height: 56, borderRadius: 16 }} />

      {/* Nav rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="flex-row items-center" style={{ gap: 12 }}>
          <Skeleton style={{ width: 40, height: 40, borderRadius: 12 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonText width={120} height={14} />
            <SkeletonText width={180} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeleton for the order detail screen.
 */
export function OrderDetailSkeleton() {
  return (
    <View className="flex-1 bg-background px-4 pt-4" style={{ gap: 16 }}>
      {/* Event header */}
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <Skeleton style={{ width: 64, height: 64, borderRadius: 12 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonText width={180} height={16} />
          <SkeletonText width={120} height={12} />
        </View>
      </View>

      {/* Payment summary card */}
      <Skeleton style={{ width: "100%", height: 140, borderRadius: 16 }} />

      {/* Timeline */}
      <View style={{ gap: 12 }}>
        <SkeletonText width={80} height={12} />
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className="flex-row items-center" style={{ gap: 10 }}>
            <SkeletonCircle size={24} />
            <View style={{ flex: 1, gap: 4 }}>
              <SkeletonText width={140} height={13} />
              <SkeletonText width={80} height={10} />
            </View>
          </View>
        ))}
      </View>

      {/* Action buttons */}
      <View style={{ gap: 10 }}>
        <Skeleton style={{ width: "100%", height: 48, borderRadius: 12 }} />
        <Skeleton style={{ width: "100%", height: 48, borderRadius: 12 }} />
      </View>
    </View>
  );
}
