import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { useLayoutEffect, useState, useEffect } from "react";
import { Platform } from "react-native";

let Updates: typeof import("expo-updates") | null = null;
try {
  if (Platform.OS !== "web") {
    Updates = require("expo-updates");
  }
} catch {}
import {
  User,
  Bell,
  Lock,
  HelpCircle,
  Shield,
  FileText,
  LogOut,
  Moon,
  Globe,
  Archive,
  Heart,
  UserX,
  MessageCircle,
  Eye,
  EyeOff,
  Info,
  CheckCircle,
  ShieldCheck,
  Megaphone,
  X,
  Bug,
  Trash2,
  Fingerprint,
  Download,
  CreditCard,
  Banknote,
  CloudRain,
  LayoutGrid,
  Crown,
} from "lucide-react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { SettingsSection } from "@dvnt/app/components/settings/SettingsSection";
import { SettingsListItem } from "@dvnt/app/components/settings/SettingsListItem";
import { Switch } from "@dvnt/app/components/ui/switch";
import { deleteAccountPrivileged } from "@dvnt/app/lib/supabase/privileged";
import { toast } from "sonner-native";
import { useBiometrics } from "@dvnt/app/lib/hooks/use-biometrics";

export default function SettingsScreenIOS() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const setNsfwEnabled = useAppStore((s) => s.setNsfwEnabled);
  const feedMode = useAppStore((s) => s.feedMode);
  const setFeedMode = useAppStore((s) => s.setFeedMode);

  // Set up header with useLayoutEffect
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: "Settings",
      headerTitleAlign: "left" as const,
      headerStyle: {
        backgroundColor: colors.background,
      },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 18,
      },
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (router.canDismiss()) {
              router.dismiss();
            } else {
              router.back();
            }
          }}
          hitSlop={12}
          style={{
            marginLeft: 8,
            padding: 4,
          }}
        >
          <X size={18} color={colors.foreground} strokeWidth={2.5} />
        </Pressable>
      ),
      headerRight: () => null,
    });
  }, [navigation, colors, router]);

  const [isDeleting, setIsDeleting] = useState(false);

  // OTA Update state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Check for updates on mount
  useEffect(() => {
    const checkForUpdate = async () => {
      if (!Updates) {
        setUpdateAvailable(false);
        return;
      }
      try {
        const update = await Updates.checkForUpdateAsync();
        setUpdateAvailable(update.isAvailable);
      } catch (e) {
        // In dev or if check fails, hide the button
        setUpdateAvailable(false);
      }
    };
    if (!__DEV__) {
      checkForUpdate();
    }
  }, []);

  const handleCheckForUpdates = async () => {
    if (!Updates) {
      toast.info("Updates are not available in this build");
      return;
    }
    setIsCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setUpdateAvailable(true);
        setIsDownloading(true);
        await Updates.fetchUpdateAsync();
        setIsDownloading(false);
        Alert.alert(
          "Update Ready",
          "A new update has been downloaded. Restart the app to apply it.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Restart Now",
              onPress: async () => {
                try {
                  await Updates?.reloadAsync();
                } catch {
                  // reloadAsync may fail on some OS versions — update applies on next cold start
                }
              },
            },
          ],
        );
      } else {
        setUpdateAvailable(false);
        toast.success("You're up to date!", {
          description: "No new updates available",
        });
      }
    } catch (e: any) {
      toast.error("Update check failed", {
        description: e?.message || "Please try again later",
      });
    } finally {
      setIsCheckingUpdate(false);
      setIsDownloading(false);
    }
  };

  // Biometric authentication
  const {
    isAvailable: biometricAvailable,
    biometricType,
    isEnabled: biometricEnabled,
    isAuthenticating,
    enable: enableBiometric,
    disable: disableBiometric,
    getBiometricName,
  } = useBiometrics();

  const handleToggleBiometric = async () => {
    if (biometricEnabled) {
      // Disable biometrics
      await disableBiometric();
      toast.success(`${getBiometricName()} disabled`, {
        description: "Biometric authentication has been turned off",
      });
    } else {
      // Enable biometrics - this will prompt for authentication
      const success = await enableBiometric();
      if (success) {
        toast.success(`${getBiometricName()} enabled`, {
          description: "App will now require biometric authentication",
        });
      } else {
        toast.error("Failed to enable biometrics", {
          description: "Please check your device settings",
        });
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "Are you sure you want to permanently delete your account? This action cannot be undone and all your data will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, I'm sure",
          style: "destructive",
          onPress: () => {
            // Second confirmation
            Alert.alert(
              "Final Confirmation",
              "This is your last chance. Your account and all associated data will be permanently deleted.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete My Account",
                  style: "destructive",
                  onPress: async () => {
                    setIsDeleting(true);
                    try {
                      await deleteAccountPrivileged();
                      toast.success("Account deleted", {
                        description:
                          "Your account has been permanently deleted",
                      });
                      logout();
                      router.replace("/login");
                    } catch (err: any) {
                      toast.error("Error", {
                        description: err?.message || "Something went wrong",
                      });
                    } finally {
                      setIsDeleting(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={[]} className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* User Info Card - iOS Style */}
          {user && (
            <View className="mx-4 mt-4 rounded-lg bg-card p-4">
              <Text className="text-lg font-semibold">{user.name}</Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                {user.email}
              </Text>
            </View>
          )}

          {/* Account Settings */}
          <SettingsSection title="Account">
            <SettingsListItem
              icon={<User size={20} color="#666" />}
              label="Account Information"
              onPress={() => router.push("/settings/account" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Lock size={20} color="#666" />}
              label="Privacy"
              onPress={() => router.push("/settings/privacy" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Eye size={20} color="#666" />}
              label="Close Friends"
              onPress={() => router.push("/settings/close-friends" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<UserX size={20} color="#666" />}
              label="Blocked"
              onPress={() => router.push("/settings/blocked" as any)}
            />
          </SettingsSection>

          {/* Payments */}
          <SettingsSection title="Payments">
            <SettingsListItem
              icon={<CreditCard size={20} color="#8A40CF" />}
              label="Payments"
              onPress={() => router.push("/settings/payments" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Banknote size={20} color="#22C55E" />}
              label="Organizer Payments"
              onPress={() => router.push("/settings/host-payments" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Crown size={20} color="#8A40CF" />}
              label="Sneaky Lynk Subscription"
              onPress={() =>
                router.push("/(protected)/sneaky-lynk/billing" as any)
              }
            />
          </SettingsSection>

          {/* Security */}
          <SettingsSection title="Security">
            {biometricAvailable ? (
              <Pressable
                onPress={handleToggleBiometric}
                disabled={isAuthenticating}
                className="flex-row items-center justify-between bg-card px-4 py-3 active:bg-secondary/50"
              >
                <View className="flex-1 flex-row items-center gap-3 mr-3">
                  <Fingerprint
                    size={20}
                    color={biometricEnabled ? "#22c55e" : "#666"}
                  />
                  <View className="flex-1 shrink">
                    <Text className="text-base text-foreground">
                      {getBiometricName()}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {biometricEnabled
                        ? "App locked with biometric authentication"
                        : `Use ${getBiometricName()} to unlock the app`}
                    </Text>
                  </View>
                </View>
                <View style={{ minWidth: 40, alignItems: "flex-end" }}>
                  {isAuthenticating ? (
                    <Text className="text-sm text-muted-foreground">
                      Verifying...
                    </Text>
                  ) : (
                    <Switch
                      checked={biometricEnabled}
                      onCheckedChange={handleToggleBiometric}
                    />
                  )}
                </View>
              </Pressable>
            ) : (
              <View className="bg-card px-4 py-3">
                <View className="flex-row items-center gap-3">
                  <Fingerprint size={20} color="#999" />
                  <View className="flex-1">
                    <Text className="text-base text-muted-foreground">
                      Biometrics Not Available
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Set up Face ID or Touch ID in device settings
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </SettingsSection>

          {/* Notifications & Interactions */}
          <SettingsSection title="Notifications">
            <SettingsListItem
              icon={<Bell size={20} color="#666" />}
              label="Push Notifications"
              onPress={() => router.push("/settings/notifications" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<MessageCircle size={20} color="#666" />}
              label="Messages"
              onPress={() => router.push("/settings/messages" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Heart size={20} color="#666" />}
              label="Likes and Comments"
              onPress={() => router.push("/settings/likes-comments" as any)}
            />
          </SettingsSection>

          {/* Content & Display */}
          <SettingsSection title="Content">
            <SettingsListItem
              icon={<Archive size={20} color="#666" />}
              label="Archived"
              onPress={() => router.push("/settings/archived" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <View className="flex-row items-center justify-between bg-card px-4 py-3">
              <View className="flex-row items-center gap-3">
                <LayoutGrid size={20} color="#666" />
                <View>
                  <Text className="text-base text-foreground">Feed Layout</Text>
                  <Text className="text-xs text-muted-foreground">
                    Switch between list and grid view
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center rounded-lg overflow-hidden border border-border">
                <Pressable
                  onPress={() => setFeedMode("classic")}
                  className="px-3 py-1.5"
                  style={{
                    backgroundColor:
                      feedMode === "classic"
                        ? "rgba(62,164,229,0.2)"
                        : "transparent",
                  }}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{
                      color: feedMode === "classic" ? "#3EA4E5" : "#888",
                    }}
                  >
                    Feed
                  </Text>
                </Pressable>
                <View className="w-px h-5 bg-border" />
                <Pressable
                  onPress={() => setFeedMode("masonry")}
                  className="px-3 py-1.5"
                  style={{
                    backgroundColor:
                      feedMode === "masonry"
                        ? "rgba(62,164,229,0.2)"
                        : "transparent",
                  }}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{
                      color: feedMode === "masonry" ? "#3EA4E5" : "#888",
                    }}
                  >
                    Grid
                  </Text>
                </Pressable>
              </View>
            </View>
            <View className="ml-12 h-px bg-border" />
            <View className="flex-row items-center justify-between bg-card px-4 py-3">
              <View className="flex-row items-center gap-3">
                <Text style={{ fontSize: 20 }}>😈</Text>
                <View>
                  <Text className="text-base text-foreground">
                    Show Spicy Content
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Display mature content in feed
                  </Text>
                </View>
              </View>
              <Switch checked={nsfwEnabled} onCheckedChange={setNsfwEnabled} />
            </View>
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<CloudRain size={20} color="#8A40CF" />}
              label="Weather Ambiance"
              onPress={() => router.push("/settings/weather-ambiance" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Moon size={20} color="#666" />}
              label="Theme"
              value="System"
              onPress={() => router.push("/settings/theme" as any)}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Globe size={20} color="#666" />}
              label="Language"
              value="English"
              onPress={() => router.push("/settings/language" as any)}
            />
          </SettingsSection>

          {/* About DVNT */}
          <SettingsSection title="About DVNT">
            <SettingsListItem
              icon={<Info size={20} color="#666" />}
              label="About / Community Focus"
              onPress={() => router.push("/settings/about")}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<CheckCircle size={20} color="#666" />}
              label="Eligibility Criteria"
              onPress={() => router.push("/settings/eligibility")}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<ShieldCheck size={20} color="#666" />}
              label="Identity Protection"
              onPress={() => router.push("/settings/identity-protection")}
            />
          </SettingsSection>

          {/* Legal & Policies */}
          <SettingsSection title="Legal & Policies">
            <SettingsListItem
              icon={<Shield size={20} color="#666" />}
              label="Privacy Policy"
              onPress={() => router.push("/settings/privacy-policy")}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<FileText size={20} color="#666" />}
              label="Terms of Service"
              onPress={() => router.push("/settings/terms")}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<FileText size={20} color="#666" />}
              label="Community Standards"
              onPress={() => router.push("/settings/community-guidelines")}
            />
            <View className="ml-12 h-px bg-border" />
            <SettingsListItem
              icon={<Megaphone size={20} color="#666" />}
              label="Advertising Policy"
              onPress={() => router.push("/settings/ad-policy")}
            />
          </SettingsSection>

          {/* Support */}
          <SettingsSection title="Support">
            <SettingsListItem
              icon={<HelpCircle size={20} color="#666" />}
              label="Help Center / FAQ"
              onPress={() => router.push("/settings/faq")}
            />
          </SettingsSection>

          {/* App Updates - only show in production */}
          {!__DEV__ && (
            <SettingsSection title="App Updates">
              <Pressable
                onPress={handleCheckForUpdates}
                disabled={
                  isCheckingUpdate || isDownloading || updateAvailable === false
                }
                className={`flex-row items-center justify-between bg-card px-4 py-3 ${
                  updateAvailable === false
                    ? "opacity-50"
                    : "active:bg-secondary/50"
                }`}
              >
                <View className="flex-row items-center gap-3">
                  <Download
                    size={20}
                    color={updateAvailable ? "#22c55e" : "#666"}
                  />
                  <View>
                    <Text className="text-base text-foreground">
                      {isDownloading
                        ? "Downloading Update..."
                        : updateAvailable
                          ? "Update Available"
                          : "Check for Updates"}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {updateAvailable === false
                        ? "You're on the latest version"
                        : updateAvailable
                          ? "Tap to download and install"
                          : "Get the latest features and fixes"}
                    </Text>
                  </View>
                </View>
                {(isCheckingUpdate || isDownloading) && (
                  <ActivityIndicator size="small" color="#3EA4E5" />
                )}
              </Pressable>
            </SettingsSection>
          )}

          {/* Developer */}
          {__DEV__ && (
            <SettingsSection title="Developer">
              <SettingsListItem
                icon={<Bug size={20} color="#f97316" />}
                label="Network Debug"
                onPress={() => router.push("/(protected)/debug" as any)}
              />
            </SettingsSection>
          )}

          {/* Danger Zone */}
          <SettingsSection title="Danger Zone">
            <Pressable
              onPress={handleDeleteAccount}
              disabled={isDeleting}
              className="flex-row items-center gap-3 bg-card px-4 py-3 active:bg-secondary/50"
            >
              <Trash2 size={20} color="#ef4444" />
              <Text className="text-base text-destructive">
                {isDeleting ? "Deleting..." : "Delete Account"}
              </Text>
            </Pressable>
          </SettingsSection>

          {/* Logout Button - iOS Style */}
          <View className="mx-4 mb-4 mt-2 overflow-hidden rounded-lg">
            <Pressable
              onPress={handleLogout}
              className="flex-row items-center justify-center gap-2 bg-card py-3 active:bg-secondary/50"
            >
              <LogOut size={20} color="#ef4444" />
              <Text className="font-semibold text-destructive">Log Out</Text>
            </Pressable>
          </View>

          {/* App Version — long-press opens OTA diagnostics */}
          <View className="items-center pb-8 pt-4">
            <Pressable
              onLongPress={() => router.push("/(protected)/debug-ota" as any)}
              delayLongPress={1000}
              hitSlop={12}
            >
              <Text className="text-xs text-muted-foreground">
                Version 1.0.0
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Main>
    </SafeAreaView>
  );
}
