/**
 * Deep Link Tester (Dev Only)
 * Paste a URL, simulate parse + navigation, see resolved route + policy.
 */

import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ChevronLeft, Play, Copy, Link2 } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useState, useCallback } from "react";
import {
  parseIncomingUrl,
  routePolicy,
  resolveNavigationTarget,
  handleDeepLink,
  ROUTE_REGISTRY,
} from "@dvnt/app/lib/deep-linking";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";

const SAMPLE_URLS = [
  "https://dvntapp.live/u/mikevocalz",
  "https://dvntapp.live/p/42",
  "https://dvntapp.live/e/7",
  "https://dvntapp.live/story/15",
  "https://dvntapp.live/messages",
  "https://dvntapp.live/auth/reset?token=abc123",
  "dvnt://u/mikevocalz",
  "dvnt://p/42",
  "dvnt://settings/close-friends",
  "https://dvntapp.live/unknown-route",
];

function DeepLinkTesterScreenContent() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const pendingLink = useDeepLinkStore((s) => s.pendingLink);

  const handleTest = useCallback(() => {
    if (!url.trim()) return;

    const parsed = parseIncomingUrl(url.trim());
    const policy = parsed ? routePolicy(parsed.path) : null;
    const target = parsed ? resolveNavigationTarget(parsed) : null;

    const output = [
      `── Parse Result ──`,
      parsed
        ? [
            `Path: ${parsed.path}`,
            `Router Path: ${parsed.routerPath}`,
            `Params: ${JSON.stringify(parsed.params)}`,
            `Requires Auth: ${parsed.requiresAuth}`,
          ].join("\n")
        : "FAILED TO PARSE",
      "",
      `── Route Policy ──`,
      policy
        ? [
            `Public: ${policy.isPublic}`,
            `Requires Auth: ${policy.requiresAuth}`,
            `Matched: ${policy.matchedEntry?.label || "NONE"}`,
          ].join("\n")
        : "NO POLICY",
      "",
      `── Navigation Target ──`,
      target
        ? [
            `Path: ${target.path}`,
            `Valid: ${target.valid}`,
            target.reason ? `Reason: ${target.reason}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "NO TARGET",
    ].join("\n");

    setResult(output);
  }, [url]);

  const handleNavigate = useCallback(() => {
    if (!url.trim()) return;
    handleDeepLink(url.trim());
  }, [url]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-row items-center border-b border-border px-4 py-3">
        <Pressable onPress={() => router.back()} className="mr-3" hitSlop={12}>
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-foreground">
          Deep Link Tester
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* URL Input */}
        <View className="rounded-xl bg-card p-3 mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2">
            PASTE URL
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://dvntapp.live/u/mikevocalz"
            placeholderTextColor="#666"
            className="text-foreground text-sm"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Action Buttons */}
        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={handleTest}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3"
          >
            <Copy size={16} color="#000" />
            <Text className="font-semibold text-black">Parse</Text>
          </Pressable>
          <Pressable
            onPress={handleNavigate}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl py-3"
            style={{ backgroundColor: "#8A40CF" }}
          >
            <Play size={16} color="#fff" />
            <Text className="font-semibold text-white">Navigate</Text>
          </Pressable>
        </View>

        {/* Result */}
        {result && (
          <View className="rounded-xl bg-card p-4 mb-4">
            <Text className="text-xs font-semibold text-muted-foreground mb-2">
              RESULT
            </Text>
            <Text className="text-foreground text-xs font-mono">{result}</Text>
          </View>
        )}

        {/* Pending Link */}
        <View className="rounded-xl bg-card p-4 mb-4">
          <Text className="text-xs font-semibold text-muted-foreground mb-2">
            PENDING LINK
          </Text>
          <Text className="text-foreground text-xs">
            {pendingLink
              ? `${pendingLink.path} (${pendingLink.originalUrl})`
              : "None"}
          </Text>
        </View>

        {/* Sample URLs */}
        <Text className="text-xs font-semibold text-muted-foreground mb-2">
          SAMPLE URLS
        </Text>
        {SAMPLE_URLS.map((sampleUrl) => (
          <Pressable
            key={sampleUrl}
            onPress={() => setUrl(sampleUrl)}
            className="flex-row items-center gap-2 rounded-lg bg-card px-3 py-2.5 mb-2 active:bg-secondary/30"
          >
            <Link2 size={14} color="#666" />
            <Text className="text-foreground text-xs flex-1" numberOfLines={1}>
              {sampleUrl}
            </Text>
          </Pressable>
        ))}

        {/* Route Registry */}
        <Text className="text-xs font-semibold text-muted-foreground mt-4 mb-2">
          ROUTE REGISTRY ({ROUTE_REGISTRY.length} routes)
        </Text>
        {ROUTE_REGISTRY.map((entry) => (
          <View
            key={entry.urlPattern}
            className="flex-row items-center justify-between rounded-lg bg-card px-3 py-2 mb-1"
          >
            <View className="flex-1">
              <Text className="text-foreground text-xs font-semibold">
                {entry.urlPattern}
              </Text>
              <Text className="text-muted-foreground text-[10px]">
                {entry.label}
              </Text>
            </View>
            <View
              className="rounded-full px-2 py-0.5"
              style={{
                backgroundColor:
                  entry.auth === "public"
                    ? "rgba(74, 222, 128, 0.15)"
                    : "rgba(138, 64, 207, 0.15)",
              }}
            >
              <Text
                className="text-[10px] font-semibold"
                style={{
                  color: entry.auth === "public" ? "#4ADE80" : "#8A40CF",
                }}
              >
                {entry.auth}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function DeepLinkTesterScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="DeepLinkTester" onGoBack={() => router.back()}>
      <DeepLinkTesterScreenContent />
    </ErrorBoundary>
  );
}
