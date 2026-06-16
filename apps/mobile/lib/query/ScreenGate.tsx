/**
 * ScreenGate — Render gating component for ScreenDTO pattern.
 *
 * Rules:
 * - Above-the-fold UI NEVER renders with partial real data.
 * - Shows stable skeleton until the primary ScreenDTO query resolves.
 * - Shows error state with retry on failure.
 *
 * Usage:
 *   <ScreenGate query={eventsQuery} skeleton={<EventsSkeleton />}>
 *     {(data) => <EventsList events={data} />}
 *   </ScreenGate>
 */

import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";

interface ScreenGateProps<T> {
  query: UseQueryResult<T, Error>;
  skeleton: React.ReactNode;
  children: (data: T) => React.ReactNode;
  errorFallback?: (error: Error, retry: () => void) => React.ReactNode;
}

export function ScreenGate<T>({
  query,
  skeleton,
  children,
  errorFallback,
}: ScreenGateProps<T>) {
  const { data, isLoading, isError, error, refetch, isSuccess } = query;

  if (isLoading) {
    return <>{skeleton}</>;
  }

  if (isError && error) {
    if (errorFallback) {
      return <>{errorFallback(error, () => refetch())}</>;
    }
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <Text style={{ color: "#a1a1aa", fontSize: 16, textAlign: "center", marginBottom: 16 }}>
          Something went wrong
        </Text>
        <Text style={{ color: "#52525b", fontSize: 13, textAlign: "center", marginBottom: 24 }}>
          {error.message || "Please try again"}
        </Text>
        <Pressable
          onPress={() => refetch()}
          style={{
            paddingHorizontal: 24,
            paddingVertical: 12,
            backgroundColor: "#27272a",
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isSuccess && data !== undefined && data !== null) {
    return <>{children(data)}</>;
  }

  return <>{skeleton}</>;
}

/**
 * InfiniteScreenGate — Same pattern for useInfiniteQuery results.
 */
interface InfiniteScreenGateProps<T> {
  query: {
    data: { pages: T[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
    isSuccess: boolean;
  };
  skeleton: React.ReactNode;
  children: (pages: T[]) => React.ReactNode;
  errorFallback?: (error: Error, retry: () => void) => React.ReactNode;
}

export function InfiniteScreenGate<T>({
  query,
  skeleton,
  children,
  errorFallback,
}: InfiniteScreenGateProps<T>) {
  const { data, isLoading, isError, error, refetch, isSuccess } = query;

  if (isLoading) {
    return <>{skeleton}</>;
  }

  if (isError && error) {
    if (errorFallback) {
      return <>{errorFallback(error, () => refetch())}</>;
    }
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <Text style={{ color: "#a1a1aa", fontSize: 16, textAlign: "center", marginBottom: 16 }}>
          Something went wrong
        </Text>
        <Pressable
          onPress={() => refetch()}
          style={{
            paddingHorizontal: 24,
            paddingVertical: 12,
            backgroundColor: "#27272a",
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isSuccess && data?.pages) {
    return <>{children(data.pages)}</>;
  }

  return <>{skeleton}</>;
}

/**
 * Minimal loading indicator for non-primary queries (below the fold).
 */
export function InlineLoader() {
  return (
    <View style={{ padding: 16, alignItems: "center" }}>
      <ActivityIndicator size="small" color="#a1a1aa" />
    </View>
  );
}
