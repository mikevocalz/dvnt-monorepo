import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { Mail, Phone, Trash2, Pencil } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useState, useCallback, useLayoutEffect } from "react";
import { toast } from "sonner-native";
import { deleteAccountPrivileged } from "@dvnt/app/lib/supabase/privileged";

export default function AccountScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { user, setUser, logout } = useAuthStore();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setIsSaving(true);
    try {
      await usersApi.updateProfile({ name: name.trim() });
      if (user) {
        setUser({ ...user, name: name.trim() });
      }
      setIsEditing(false);
      toast.success("Profile updated");
    } catch (error: any) {
      toast.error("Failed to save", {
        description: error?.message || "Please try again",
      });
    } finally {
      setIsSaving(false);
    }
  }, [name, user, setUser]);

  const handleDeleteAccount = () => {
    setDeleteConfirmText("");
    setShowDeleteConfirm(true);
  };

  const handleConfirmDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== "DELETE") {
      toast.error("Account deletion cancelled", {
        description: "You must type DELETE to confirm",
      });
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccountPrivileged();
      toast.success("Account deleted", {
        description:
          "Your account and all associated data have been permanently deleted.",
        duration: 6000,
      });
      setShowDeleteConfirm(false);
      logout();
      router.replace("/login");
    } catch (err: any) {
      toast.error("Failed to delete account", {
        description: err?.message || "Something went wrong",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Account Information",
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: colors.foreground,
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {isEditing ? (
            <Pressable onPress={handleSave} disabled={isSaving} hitSlop={12}>
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={{
                    color: colors.primary,
                    fontWeight: "600",
                    fontSize: 16,
                  }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          ) : (
            <Pressable onPress={() => setIsEditing(true)} hitSlop={12}>
              <Pencil size={20} color={colors.foreground} />
            </Pressable>
          )}
          <SettingsCloseButton />
        </View>
      ),
    });
  }, [navigation, colors, isEditing, isSaving, handleSave]);

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-6 rounded-lg border border-border bg-card p-4">
            <Text className="mb-4 text-lg font-semibold text-foreground">
              Personal Information
            </Text>

            <View className="mb-4">
              <Text className="mb-2 text-sm text-muted-foreground">Name</Text>
              {isEditing ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={colors.mutedForeground}
                  className="rounded-lg border border-primary/50 bg-secondary/30 px-4 py-3 text-foreground"
                  autoFocus
                />
              ) : (
                <View className="flex-row items-center rounded-lg border border-border bg-secondary/30 px-4 py-3">
                  <Text className="flex-1 text-foreground">
                    {user?.name || "Not set"}
                  </Text>
                </View>
              )}
            </View>

            <View className="mb-4">
              <Text className="mb-2 text-sm text-muted-foreground">
                Username
              </Text>
              <View className="flex-row items-center rounded-lg border border-border bg-secondary/30 px-4 py-3">
                <Text className="flex-1 text-foreground">
                  @{user?.username || "Not set"}
                </Text>
              </View>
              <Text className="mt-1 text-xs text-muted-foreground">
                Username can be changed from Edit Profile
              </Text>
            </View>

            <View className="mb-4">
              <Text className="mb-2 text-sm text-muted-foreground">Email</Text>
              <View className="flex-row items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
                <Mail size={18} color="#666" />
                <Text className="flex-1 text-foreground">
                  {user?.email || "Not set"}
                </Text>
              </View>
            </View>

            <View>
              <Text className="mb-2 text-sm text-muted-foreground">Phone</Text>
              <View className="flex-row items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
                <Phone size={18} color="#666" />
                <Text className="flex-1 text-muted-foreground">Not linked</Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleDeleteAccount}
            disabled={isDeleting}
            className="flex-row items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 py-4 active:bg-destructive/20"
          >
            <Trash2 size={20} color="#ef4444" />
            <Text className="font-semibold text-destructive">
              {isDeleting ? "Deleting..." : "Delete Account"}
            </Text>
          </Pressable>

          <Text className="mt-4 text-center text-xs text-muted-foreground">
            Deleting your account is permanent and cannot be undone.
          </Text>
        </ScrollView>
      </Main>

      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) setShowDeleteConfirm(false);
        }}
      >
        <View className="flex-1 justify-center bg-black/70 px-5">
          <View className="rounded-xl border border-destructive/30 bg-card p-5">
            <Text className="text-xl font-semibold text-foreground">
              Delete Account
            </Text>
            <Text className="mt-3 text-sm leading-5 text-muted-foreground">
              This permanently deletes your DVNT account, ends active Lynk rooms
              you host, deregisters push tokens, and removes or anonymizes
              associated data required for bookkeeping.
            </Text>
            <Text className="mt-5 text-sm font-medium text-foreground">
              Type DELETE to confirm
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              editable={!isDeleting}
              className="mt-2 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-foreground"
            />
            <View className="mt-5 flex-row gap-3">
              <Pressable
                disabled={isDeleting}
                onPress={() => setShowDeleteConfirm(false)}
                className="flex-1 items-center rounded-lg border border-border py-3 active:bg-secondary/40"
              >
                <Text className="font-semibold text-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                disabled={isDeleting || deleteConfirmText.trim() !== "DELETE"}
                onPress={handleConfirmDeleteAccount}
                className="flex-1 items-center rounded-lg bg-destructive py-3 disabled:opacity-50"
              >
                <Text className="font-semibold text-destructive-foreground">
                  {isDeleting ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
