import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useNavigation } from "@react-navigation/native";
import {
  Camera,
  ChevronRight,
  Link as LinkIcon,
  Plus,
  Trash2,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useProfileStore } from "@dvnt/app/lib/stores/profile-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useEffect, useState } from "react";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { appendCacheBuster } from "@dvnt/app/lib/media/resolveAvatarUrl";
import { useUpdateProfile } from "@dvnt/app/lib/hooks/use-profile";

const PRONOUNS_OPTIONS = [
  "He/Him",
  "She/Her",
  "They/Them",
  "He/They",
  "She/They",
  "Ze/Zir",
  "Custom",
];

const GENDER_OPTIONS = [
  "Male",
  "Female",
  "Trans Male",
  "Trans Female",
  "Non-binary",
  "Prefer not to say",
  "Custom",
];

function sanitizeLinks(value: unknown[]): string[] {
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeLinks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return sanitizeLinks(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitizeLinks(parsed);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function EditProfileScreenContent() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const user = useAuthStore((state) => state.user);
  const showToast = useUIStore((s) => s.showToast);
  const updateProfile = useUpdateProfile();
  const [isSaving, setIsSaving] = useState(false);
  const [newAvatarUri, setNewAvatarUri] = useState<string | null>(null);
  const { uploadSingle, isUploading, progress } = useMediaUpload({
    folder: "avatars",
    userId: user?.id,
  });
  const {
    editName,
    editBio,
    editWebsite,
    editLocation,
    setEditName,
    setEditBio,
    setEditWebsite,
    setEditLocation,
  } = useProfileStore();

  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [gender, setGender] = useState("");
  const [links, setLinks] = useState<string[]>(() =>
    normalizeLinks((user as any)?.links),
  );
  const [newLink, setNewLink] = useState("");
  const [showPronouns, setShowPronouns] = useState(false);
  const [showGender, setShowGender] = useState(false);

  const validateUsername = (value: string): string => {
    if (!value.trim()) return "Username is required";
    if (value.length < 3) return "Must be at least 3 characters";
    if (value.length > 30) return "Must be 30 characters or less";
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return "Only letters, numbers, and underscores";
    }
    return "";
  };

  const handleUsernameChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(cleaned);
    setUsernameError(validateUsername(cleaned));
  };

  const handlePickAvatar = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "error",
          "Permission Required",
          "Please grant media library access to change your photo.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setNewAvatarUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error("[EditProfile] Pick avatar error:", error);
      showToast("error", "Error", "Failed to pick image. Please try again.");
    }
  };

  const addLink = () => {
    const trimmed = newLink.trim();
    if (!trimmed) return;
    if (links.length >= 4) {
      showToast("warning", "Limit", "You can add up to 4 links");
      return;
    }
    setLinks((prev) => [...prev, trimmed]);
    setNewLink("");
  };

  const removeLink = (index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!user) {
      showToast("error", "Error", "User not found");
      return;
    }

    setIsSaving(true);

    try {
      let avatarUrl = user.avatar;

      if (newAvatarUri) {
        try {
          const uploadResult = await uploadSingle(newAvatarUri);
          if (uploadResult.success && uploadResult.url) {
            avatarUrl = appendCacheBuster(uploadResult.url) || uploadResult.url;
          } else {
            showToast(
              "warning",
              "Upload Issue",
              "Avatar upload failed. Other changes will be saved.",
            );
          }
        } catch (uploadError) {
          console.error("[EditProfile] Avatar upload exception:", uploadError);
          showToast(
            "warning",
            "Upload Issue",
            "Avatar upload failed. Other changes will be saved.",
          );
        }
      }

      const trimmedUsername = username.trim().toLowerCase();
      const usernameErr = validateUsername(trimmedUsername);
      if (usernameErr) {
        setUsernameError(usernameErr);
        setIsSaving(false);
        return;
      }

      const nextPronouns = pronouns.trim();
      const nextGender = gender.trim();
      const allLinks = Array.from(
        new Set([
          ...(editWebsite.trim() ? [editWebsite.trim()] : []),
          ...normalizeLinks(links),
        ]),
      ).slice(0, 4);

      const updateData: {
        name?: string;
        bio?: string;
        website?: string;
        links?: string[];
        location?: string;
        avatar?: string;
        username?: string;
        pronouns?: string;
        gender?: string;
      } = {
        name: editName.trim(),
        bio: editBio.trim(),
        website: editWebsite.trim(),
        links: allLinks,
        location: editLocation.trim(),
        pronouns: nextPronouns,
        gender: nextGender,
        ...(avatarUrl ? { avatar: avatarUrl } : {}),
        ...(trimmedUsername !== (user.username || "").toLowerCase()
          ? { username: trimmedUsername }
          : {}),
      };

      updateProfile.mutate(updateData, {
        onSuccess: () => {
          showToast("success", "Saved", "Profile updated successfully");
        },
        onError: (error: any) => {
          console.error("[EditProfile] Save error:", error);
          const errorMessage =
            error?.message || "Failed to save profile. Please try again.";
          showToast("error", "Error", errorMessage);
        },
      });

      navigation.goBack();
      return;
    } catch (error: any) {
      console.error("[EditProfile] Save error:", error);
      const errorMessage =
        error?.message || "Failed to save profile. Please try again.";
      showToast("error", "Error", errorMessage);
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (user) {
      setEditName(user.name || "");
      setEditBio(user.bio || "");
      setEditWebsite(user.website || "");
      setEditLocation(user.location || "");
      setUsername(user.username || "");
      setPronouns(typeof user.pronouns === "string" ? user.pronouns : "");
      setGender(typeof user.gender === "string" ? user.gender : "");
      setLinks(normalizeLinks((user as any)?.links));
      return;
    }

    setUsername("");
    setPronouns("");
    setGender("");
    setLinks([]);
  }, [user, setEditName, setEditBio, setEditWebsite, setEditLocation]);

  const rowStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  };

  const labelStyle = {
    fontSize: 15,
    color: colors.foreground,
    width: 100,
  };

  const inputStyle = {
    flex: 1,
    fontSize: 15,
    color: colors.foreground,
    textAlign: "right" as const,
    paddingVertical: 0,
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={{ fontSize: 16, color: colors.foreground }}>Cancel</Text>
        </Pressable>
        <Text
          style={{
            fontSize: 17,
            fontWeight: "600",
            color: colors.foreground,
          }}
        >
          Edit Profile
        </Text>
        <Pressable onPress={handleSave} disabled={isSaving} hitSlop={12}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: isSaving ? colors.mutedForeground : colors.primary,
            }}
          >
            {isSaving ? "Saving..." : "Done"}
          </Text>
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={100}
      >
        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Pressable
            onPress={handlePickAvatar}
            style={{ position: "relative" }}
          >
            <Avatar
              uri={newAvatarUri || user?.avatar || ""}
              username={user?.username || "User"}
              size={96}
              variant="roundedSquare"
            />
            {isUploading ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 20,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#fff", fontSize: 11, marginTop: 4 }}>
                  {Math.round(progress)}%
                </Text>
              </View>
            ) : (
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 3,
                  borderColor: colors.background,
                }}
              >
                <Camera size={14} color="#fff" />
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={handlePickAvatar}
            disabled={isUploading}
            style={{ marginTop: 12 }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: colors.primary,
              }}
            >
              Change Photo
            </Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: colors.mutedForeground,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            About You
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={rowStyle}>
              <Text style={labelStyle}>Name</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                style={inputStyle}
                maxLength={100}
              />
            </View>

            <View style={rowStyle}>
              <Text style={labelStyle}>Username</Text>
              <TextInput
                value={username}
                onChangeText={handleUsernameChange}
                placeholder="username"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
                maxLength={30}
              />
            </View>
            {usernameError ? (
              <Text
                style={{
                  fontSize: 12,
                  color: "#ef4444",
                  textAlign: "right",
                  paddingBottom: 8,
                }}
              >
                {usernameError}
              </Text>
            ) : null}

            <Pressable
              style={rowStyle}
              onPress={() => setShowPronouns(!showPronouns)}
            >
              <Text style={labelStyle}>Pronouns</Text>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    color: pronouns
                      ? colors.foreground
                      : colors.mutedForeground,
                  }}
                >
                  {pronouns || "Add pronouns"}
                </Text>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </View>
            </Pressable>

            {showPronouns && (
              <View
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {PRONOUNS_OPTIONS.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setPronouns(option === pronouns ? "" : option);
                        if (option !== "Custom") setShowPronouns(false);
                      }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor:
                          pronouns === option ? colors.primary : colors.muted,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "500",
                          color:
                            pronouns === option ? "#fff" : colors.foreground,
                        }}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {pronouns === "Custom" && (
                  <TextInput
                    value={pronouns === "Custom" ? "" : pronouns}
                    onChangeText={setPronouns}
                    placeholder="Enter your pronouns"
                    placeholderTextColor={colors.mutedForeground}
                    style={{
                      fontSize: 14,
                      color: colors.foreground,
                      marginTop: 8,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  />
                )}
              </View>
            )}

            <View style={{ ...rowStyle, alignItems: "flex-start" }}>
              <Text style={{ ...labelStyle, paddingTop: 2 }}>Bio</Text>
              <TextInput
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Write something about yourself..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                textAlignVertical="top"
                maxLength={150}
                style={{
                  ...inputStyle,
                  minHeight: 60,
                  textAlign: "right" as const,
                }}
              />
            </View>

            <Pressable
              style={{ ...rowStyle, borderBottomWidth: 0 }}
              onPress={() => setShowGender(!showGender)}
            >
              <Text style={labelStyle}>Gender</Text>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    color: gender ? colors.foreground : colors.mutedForeground,
                  }}
                >
                  {gender || "Prefer not to say"}
                </Text>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </View>
            </Pressable>

            {showGender && (
              <View style={{ paddingBottom: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {GENDER_OPTIONS.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setGender(option === gender ? "" : option);
                        if (option !== "Custom") setShowGender(false);
                      }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor:
                          gender === option ? colors.primary : colors.muted,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "500",
                          color: gender === option ? "#fff" : colors.foreground,
                        }}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: colors.mutedForeground,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            Links
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={rowStyle}>
              <LinkIcon size={18} color={colors.mutedForeground} />
              <TextInput
                value={editWebsite}
                onChangeText={setEditWebsite}
                placeholder="Website"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                keyboardType="url"
                style={{ ...inputStyle, textAlign: "left", marginLeft: 12 }}
              />
            </View>

            {links.map((link, index) => (
              <View key={index} style={rowStyle}>
                <LinkIcon size={18} color={colors.mutedForeground} />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color: colors.foreground,
                    marginLeft: 12,
                  }}
                  numberOfLines={1}
                >
                  {link}
                </Text>
                <Pressable onPress={() => removeLink(index)} hitSlop={12}>
                  <Trash2 size={18} color="#ef4444" />
                </Pressable>
              </View>
            ))}

            {links.length < 4 && (
              <View style={{ ...rowStyle, borderBottomWidth: 0 }}>
                <Plus size={18} color={colors.primary} />
                <TextInput
                  value={newLink}
                  onChangeText={setNewLink}
                  placeholder="Add link"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  keyboardType="url"
                  returnKeyType="done"
                  onSubmitEditing={addLink}
                  style={{ ...inputStyle, textAlign: "left", marginLeft: 12 }}
                />
              </View>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: colors.mutedForeground,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            Location
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ ...rowStyle, borderBottomWidth: 0 }}>
              <TextInput
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Add your city or location"
                placeholderTextColor={colors.mutedForeground}
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: colors.foreground,
                  paddingVertical: 0,
                }}
                maxLength={100}
              />
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text
            style={{
              fontSize: 12,
              color: colors.mutedForeground,
              textAlign: "right",
            }}
          >
            Bio: {editBio.length}/150
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="EditProfile" onGoBack={() => router.back()}>
      <EditProfileScreenContent />
    </ErrorBoundary>
  );
}
