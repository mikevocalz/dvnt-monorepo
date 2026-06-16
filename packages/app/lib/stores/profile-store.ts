import { create } from "zustand";

type ProfileTab = "posts" | "video" | "events" | "saved" | "tagged";

interface ProfileState {
  activeTab: ProfileTab;
  following: Record<string, boolean>;
  followers: Record<string, number>;
  editName: string;
  editBio: string;
  editWebsite: string;
  editLocation: string;
  editHashtags: string[];
  setActiveTab: (tab: ProfileTab) => void;
  toggleFollow: (userId: string, initialFollowers: number) => void;
  setEditName: (name: string) => void;
  setEditBio: (bio: string) => void;
  setEditWebsite: (website: string) => void;
  setEditLocation: (location: string) => void;
  setEditHashtags: (hashtags: string[]) => void;
  addEditHashtag: (tag: string) => void;
  removeEditHashtag: (index: number) => void;
  resetEditProfile: () => void;
}

const DEFAULT_PROFILE = {
  name: "",
  bio: "",
  website: "",
  location: "",
  hashtags: [] as string[],
};

export const useProfileStore = create<ProfileState>((set) => ({
  activeTab: "posts",
  following: {},
  followers: {},
  editName: DEFAULT_PROFILE.name,
  editBio: DEFAULT_PROFILE.bio,
  editWebsite: DEFAULT_PROFILE.website,
  editLocation: DEFAULT_PROFILE.location,
  editHashtags: DEFAULT_PROFILE.hashtags,
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleFollow: (userId, initialFollowers) =>
    set((state) => {
      const isFollowing = state.following[userId];
      return {
        following: {
          ...state.following,
          [userId]: !isFollowing,
        },
        followers: {
          ...state.followers,
          [userId]:
            (state.followers[userId] || initialFollowers) +
            (isFollowing ? -1 : 1),
        },
      };
    }),
  setEditName: (name) => set({ editName: name }),
  setEditBio: (bio) => set({ editBio: bio }),
  setEditWebsite: (website) => set({ editWebsite: website }),
  setEditLocation: (location) => set({ editLocation: location }),
  setEditHashtags: (hashtags) => set({ editHashtags: hashtags }),
  addEditHashtag: (tag) =>
    set((state) => {
      const t = tag.replace(/^#+/, "").trim().toLowerCase();
      if (!t) return state;
      const next = [...state.editHashtags];
      if (next.includes(t)) return state;
      if (next.length >= 10) return state;
      next.push(t);
      return { editHashtags: next };
    }),
  removeEditHashtag: (index) =>
    set((state) => ({
      editHashtags: state.editHashtags.filter((_, i) => i !== index),
    })),
  resetEditProfile: () =>
    set({
      editName: DEFAULT_PROFILE.name,
      editBio: DEFAULT_PROFILE.bio,
      editWebsite: DEFAULT_PROFILE.website,
      editLocation: DEFAULT_PROFILE.location,
      editHashtags: DEFAULT_PROFILE.hashtags,
    }),
}));
