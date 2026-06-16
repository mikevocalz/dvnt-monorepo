/**
 * Network Debug Screen
 *
 * PHASE 1: Diagnostic screen to verify API calls work in-app
 * Access via: /(protected)/debug
 */

import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import {
  ChevronLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// Supabase URL for debugging
const _rawDebugUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL =
  typeof _rawDebugUrl === "string" && _rawDebugUrl.startsWith("https://")
    ? _rawDebugUrl
    : "https://npfjanxturvmjyevoyfo.supabase.co";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { Platform } from "react-native";

interface TestResult {
  name: string;
  status: "pending" | "running" | "pass" | "fail";
  statusCode?: number;
  hasAuth?: boolean;
  error?: string;
  responsePreview?: string;
}

async function getAuthToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return null;
      return localStorage.getItem("dvnt_auth_token");
    }
    const SecureStore = require("expo-secure-store");
    const token = await SecureStore.getItemAsync("dvnt_auth_token");
    return token || null;
  } catch (e) {
    console.error("[Debug] getAuthToken error:", e);
    return null;
  }
}

function DebugScreenContent() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const [isRunning, setIsRunning] = useState(false);
  const [apiBase, setApiBase] = useState("");
  const [results, setResults] = useState<TestResult[]>([]);

  // Gate debug screen to development only
  if (!__DEV__) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text className="text-foreground text-lg">
          Debug screen is only available in development
        </Text>
        <Pressable onPress={() => router.back()} className="mt-4 p-4">
          <Text className="text-primary">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  useEffect(() => {
    setApiBase(SUPABASE_URL);
  }, []);

  const runTests = async () => {
    setIsRunning(true);
    const authToken = await getAuthToken();
    const API_BASE = SUPABASE_URL;

    const tests: TestResult[] = [
      { name: "GET /api/users/me", status: "pending" },
      { name: "GET /api/posts?limit=1", status: "pending" },
      { name: "GET /api/posts/feed", status: "pending" },
      { name: `GET /api/users/${user?.id || "15"}/profile`, status: "pending" },
      { name: "GET /api/conversations", status: "pending" },
      { name: "GET /api/stories", status: "pending" },
    ];

    setResults([...tests]);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers["Authorization"] = `JWT ${authToken}`;
    }

    // Test 1: GET /api/users/me
    try {
      tests[0].status = "running";
      setResults([...tests]);

      const url = `${API_BASE}/api/users/me`;
      console.log(`[Debug] Testing: GET ${url}`);
      console.log(`[Debug]   hasAuth: ${!!authToken}`);

      const res = await fetch(url, { headers, credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[0].statusCode = res.status;
      tests[0].hasAuth = !!authToken;
      tests[0].responsePreview = data.slice(0, 100);
      tests[0].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[0].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[0].status = "fail";
      tests[0].error = e.message;
      console.error(`[Debug] Test 1 error:`, e);
    }
    setResults([...tests]);

    // Test 2: GET /api/posts
    try {
      tests[1].status = "running";
      setResults([...tests]);

      const url = `${API_BASE}/api/posts?limit=1`;
      console.log(`[Debug] Testing: GET ${url}`);

      const res = await fetch(url, { credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[1].statusCode = res.status;
      tests[1].hasAuth = false;
      tests[1].responsePreview = data.slice(0, 100);
      tests[1].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[1].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[1].status = "fail";
      tests[1].error = e.message;
      console.error(`[Debug] Test 2 error:`, e);
    }
    setResults([...tests]);

    // Test 3: GET /api/posts/feed
    try {
      tests[2].status = "running";
      setResults([...tests]);

      const url = `${API_BASE}/api/posts/feed`;
      console.log(`[Debug] Testing: GET ${url}`);
      console.log(`[Debug]   hasAuth: ${!!authToken}`);

      const res = await fetch(url, { headers, credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[2].statusCode = res.status;
      tests[2].hasAuth = !!authToken;
      tests[2].responsePreview = data.slice(0, 100);
      tests[2].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[2].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[2].status = "fail";
      tests[2].error = e.message;
      console.error(`[Debug] Test 3 error:`, e);
    }
    setResults([...tests]);

    // Test 4: GET /api/users/:id/profile
    try {
      tests[3].status = "running";
      setResults([...tests]);

      const userId = user?.id || "15";
      const url = `${API_BASE}/api/users/${userId}/profile`;
      console.log(`[Debug] Testing: GET ${url}`);
      console.log(`[Debug]   hasAuth: ${!!authToken}`);

      const res = await fetch(url, { headers, credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[3].statusCode = res.status;
      tests[3].hasAuth = !!authToken;
      tests[3].responsePreview = data.slice(0, 100);
      tests[3].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[3].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[3].status = "fail";
      tests[3].error = e.message;
      console.error(`[Debug] Test 4 error:`, e);
    }
    setResults([...tests]);

    // Test 5: GET /api/conversations (requires auth)
    try {
      tests[4].status = "running";
      setResults([...tests]);

      const url = `${API_BASE}/api/conversations?box=inbox`;
      console.log(`[Debug] Testing: GET ${url}`);
      console.log(`[Debug]   hasAuth: ${!!authToken}`);

      const res = await fetch(url, { headers, credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[4].statusCode = res.status;
      tests[4].hasAuth = !!authToken;
      tests[4].responsePreview = data.slice(0, 100);
      tests[4].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[4].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[4].status = "fail";
      tests[4].error = e.message;
      console.error(`[Debug] Test 5 error:`, e);
    }
    setResults([...tests]);

    // Test 6: GET /api/stories
    try {
      tests[5].status = "running";
      setResults([...tests]);

      const url = `${API_BASE}/api/stories`;
      console.log(`[Debug] Testing: GET ${url}`);
      console.log(`[Debug]   hasAuth: ${!!authToken}`);

      const res = await fetch(url, { headers, credentials: "omit" });
      const data = await res.text();

      console.log(`[Debug]   status: ${res.status}`);
      console.log(`[Debug]   body: ${data.slice(0, 200)}`);

      tests[5].statusCode = res.status;
      tests[5].hasAuth = !!authToken;
      tests[5].responsePreview = data.slice(0, 100);
      tests[5].status = res.status === 200 ? "pass" : "fail";
      if (res.status !== 200) tests[5].error = `Status ${res.status}`;
    } catch (e: any) {
      tests[5].status = "fail";
      tests[5].error = e.message;
      console.error(`[Debug] Test 6 error:`, e);
    }
    setResults([...tests]);

    setIsRunning(false);
  };

  useEffect(() => {
    // Auto-run tests on mount
    runTests();
  }, []);

  const StatusIcon = ({ status }: { status: TestResult["status"] }) => {
    switch (status) {
      case "pass":
        return <CheckCircle size={20} color="#22c55e" />;
      case "fail":
        return <XCircle size={20} color="#ef4444" />;
      case "running":
        return <ActivityIndicator size="small" color={colors.primary} />;
      default:
        return <AlertTriangle size={20} color={colors.mutedForeground} />;
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} hitSlop={12} className="mr-4">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-bold text-foreground flex-1">
          Network Debug
        </Text>
        <Pressable onPress={runTests} disabled={isRunning} className="p-2">
          <RefreshCw
            size={20}
            color={isRunning ? colors.mutedForeground : colors.primary}
          />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-4 py-4">
        {/* API Base Info */}
        <View className="bg-card rounded-lg p-4 mb-4 border border-border">
          <Text className="text-sm font-semibold text-muted-foreground mb-1">
            API Base URL
          </Text>
          <Text className="text-sm text-foreground font-mono">{apiBase}</Text>
          <Text className="text-sm font-semibold text-muted-foreground mt-3 mb-1">
            Current User
          </Text>
          <Text className="text-sm text-foreground font-mono">
            {user ? `${user.username} (ID: ${user.id})` : "Not logged in"}
          </Text>
        </View>

        {/* Test Results */}
        <Text className="text-sm font-semibold text-muted-foreground mb-2">
          Test Results
        </Text>
        {results.map((result, index) => (
          <View
            key={index}
            className="bg-card rounded-lg p-4 mb-2 border border-border"
          >
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-semibold text-foreground flex-1">
                {result.name}
              </Text>
              <StatusIcon status={result.status} />
            </View>

            {result.statusCode !== undefined && (
              <Text className="text-xs text-muted-foreground mb-1">
                Status:{" "}
                <Text
                  className={
                    result.statusCode === 200
                      ? "text-green-500"
                      : "text-red-500"
                  }
                >
                  {result.statusCode}
                </Text>
                {" | "}Auth: {result.hasAuth ? "Yes" : "No"}
              </Text>
            )}

            {result.error && (
              <Text className="text-xs text-red-500 mb-1">
                Error: {result.error}
              </Text>
            )}

            {result.responsePreview && (
              <Text
                className="text-xs text-muted-foreground font-mono"
                numberOfLines={2}
              >
                {result.responsePreview}
              </Text>
            )}
          </View>
        ))}

        {/* Instructions */}
        <View className="mt-4 p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
          <Text className="text-sm text-yellow-500 font-semibold mb-2">
            Debug Instructions
          </Text>
          <Text className="text-xs text-yellow-500/80">
            1. Check Metro/Expo console for [Debug] logs{"\n"}
            2. If status shows 401 with hasAuth=false, token is missing{"\n"}
            3. If status shows 404, URL path is wrong{"\n"}
            4. If Network Error, check URL is reachable{"\n"}
            5. Compare with curl results
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

export default function DebugScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="Debug" onGoBack={() => router.back()}>
      <DebugScreenContent />
    </ErrorBoundary>
  );
}
