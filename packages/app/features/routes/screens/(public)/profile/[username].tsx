import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Lock, Share2, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUser } from "@dvnt/app/lib/hooks";
import { useProfilePosts } from "@dvnt/app/lib/hooks/use-posts";
import { safeGridTiles } from "@dvnt/app/lib/utils/safe-profile-mappers";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { ProfilePronounsPill } from "@dvnt/app/components/profile/ProfilePronounsPill";
import { ProfileMasonryGrid } from "@dvnt/app/components/profile/ProfileMasonryGrid";
import { Skeleton } from "@dvnt/app/components/ui/skeleton";
import { PublicLockedScreen } from "@dvnt/app/components/access/PublicLockedScreen";
import { shareProfile } from "@dvnt/app/lib/utils/sharing";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";

function formatCount(value: number | undefined) {
  if (typeof value !== "number") return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export default function PublicUserProfileScreen() {
  const { username, avatar: avatarParam, name: nameParam } =
    useLocalSearchParams<{
      username?: string;
      avatar?: string;
      name?: string;
    }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const numColumns = screenWidth >= 1024 ? 4 : screenWidth >= 768 ? 3 : 2;
  const columnWidth = (screenWidth - 2 * (numColumns + 1)) / numColumns;

  const safeUsername =
    typeof username === "string" && username.length > 0 ? username : null;

  const { data: userData, isLoading } = useUser(safeUsername);
  const { data: userPostsRaw = [], isLoading: isLoadingPosts } = useProfilePosts(
    safeUsername || "",
  );

  const visibleUserPosts = useMemo(
    () => userPostsRaw.filter((post) => !post.isNSFW),
    [userPostsRaw],
  );
  const userPosts = useMemo(
    () => safeGridTiles(visibleUserPosts),
    [visibleUserPosts],
  );

  const displayUser = {
    username: userData?.username || safeUsername || "Profile",
    name:
      userData?.name ||
      (typeof nameParam === "string" && nameParam.length > 0 ? nameParam : "") ||
      safeUsername ||
      "Profile",
    bio: userData?.bio || "",
    avatar:
      userData?.avatar ||
      (typeof avatarParam === "string" && avatarParam.length > 0
        ? avatarParam
        : ""),
    postsCount:
      typeof userData?.postsCount === "number"
        ? userData.postsCount
        : visibleUserPosts.length,
    followersCount: userData?.followersCount,
    followingCount: userData?.followingCount,
    pronouns: (userData as any)?.pronouns,
  };

  const profileAvatarUrl = resolveAvatarUrl(
    displayUser.avatar,
    __DEV__ ? `PublicProfile:${displayUser.username}` : undefined,
  );

  if (!safeUsername) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.iconSpacer} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>User not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>{displayUser.username}</Text>
        <Pressable
          onPress={() => shareProfile(displayUser.username, displayUser.name)}
          hitSlop={12}
          style={styles.iconButton}
        >
          <Share2 size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.lockBadge}>
            <Lock size={14} color="#fff" />
            <Text style={styles.lockBadgeText}>View-only profile</Text>
          </View>

          <View style={styles.heroTop}>
            {profileAvatarUrl ? (
              <Pressable onPress={() => setIsAvatarViewerOpen(true)} hitSlop={10}>
                <Avatar
                  uri={profileAvatarUrl}
                  username={displayUser.username}
                  size={80}
                  variant="roundedSquare"
                />
              </Pressable>
            ) : (
              <Avatar
                uri={undefined}
                username={displayUser.username}
                size={80}
                variant="roundedSquare"
              />
            )}

            <View style={styles.countRow}>
              <View style={styles.countItem}>
                <Text style={styles.countValue}>
                  {isLoadingPosts ? "…" : formatCount(displayUser.postsCount)}
                </Text>
                <Text style={styles.countLabel}>Posts</Text>
              </View>
              <View style={styles.countItem}>
                <Text style={styles.countValue}>
                  {isLoading ? "…" : formatCount(displayUser.followersCount)}
                </Text>
                <Text style={styles.countLabel}>Followers</Text>
              </View>
              <View style={styles.countItem}>
                <Text style={styles.countValue}>
                  {isLoading ? "…" : formatCount(displayUser.followingCount)}
                </Text>
                <Text style={styles.countLabel}>Following</Text>
              </View>
            </View>
          </View>

          <View style={styles.metaBlock}>
            {isLoading ? (
              <>
                <Skeleton style={{ width: 120, height: 18, borderRadius: 6 }} />
                <Skeleton style={{ width: "78%", height: 14, borderRadius: 6 }} />
              </>
            ) : (
              <>
                <View style={styles.nameRow}>
                  <Text style={styles.nameText}>{displayUser.name}</Text>
                  <ProfilePronounsPill pronouns={displayUser.pronouns} inline />
                </View>
                {displayUser.bio ? (
                  <Text style={styles.bioText}>{displayUser.bio}</Text>
                ) : null}
              </>
            )}
          </View>
        </View>

        <View style={styles.guardWrap}>
          <PublicLockedScreen reason="profile" kicker="PROFILE PREVIEW" />
        </View>

        <View style={styles.gridWrap}>
          {isLoading || isLoadingPosts ? (
            <View style={styles.skeletonGrid}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View
                  key={index}
                  style={{ width: columnWidth, height: columnWidth, padding: 1 }}
                >
                  <Skeleton
                    style={{ width: "100%", height: "100%", borderRadius: 8 }}
                  />
                </View>
              ))}
            </View>
          ) : (
            <ProfileMasonryGrid
              data={userPosts}
              userId={displayUser.username}
              scrollEnabled={false}
              interactive={false}
            />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={isAvatarViewerOpen && !!profileAvatarUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAvatarViewerOpen(false)}
      >
        <View style={styles.avatarViewer}>
          <Pressable
            onPress={() => setIsAvatarViewerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.avatarViewerImageWrap}>
            {profileAvatarUrl ? (
              <Image
                source={{ uri: profileAvatarUrl }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : null}
          </View>
          <Pressable
            onPress={() => setIsAvatarViewerOpen(false)}
            hitSlop={12}
            style={styles.avatarViewerClose}
          >
            <X size={20} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSpacer: {
    width: 44,
    height: 44,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 26,
    padding: 18,
    backgroundColor: "rgba(20,20,24,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 16,
  },
  lockBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  lockBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
  },
  countRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  countItem: {
    flex: 1,
    alignItems: "center",
  },
  countValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  countLabel: {
    color: "rgba(228,228,231,0.62)",
    fontSize: 12,
    marginTop: 4,
  },
  metaBlock: {
    gap: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  nameText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  bioText: {
    color: "rgba(244,244,245,0.88)",
    fontSize: 14,
    lineHeight: 20,
  },
  guardWrap: {
    marginTop: 18,
  },
  gridWrap: {
    marginTop: 18,
    paddingBottom: 32,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: {
    color: "rgba(228,228,231,0.72)",
    fontSize: 15,
  },
  avatarViewer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  avatarViewerImageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  avatarViewerClose: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
});
