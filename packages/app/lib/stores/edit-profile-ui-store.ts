import { create } from "zustand";

/**
 * Local UI/form state for the web Edit Profile screen. The native screen keeps
 * this in `useState`; per the project's Zustand-always rule the web port lifts it
 * into a store. The persisted text fields (name/bio/website/location) live in
 * `profile-store`; this holds the rest of the form's transient state.
 */
interface EditProfileUIState {
  username: string;
  usernameError: string;
  pronouns: string;
  gender: string;
  /** "I am…" identity tags (multi-select, private filter data). */
  sexuality: string[];
  /** "Looking for events w/…" audience preference. */
  eventAudience: string;
  links: string[];
  newLink: string;
  showPronouns: boolean;
  showGender: boolean;
  isSaving: boolean;
  /** Object URL / data URL of a freshly-picked avatar (pre-upload). */
  newAvatarUri: string | null;

  setUsername: (v: string) => void;
  setUsernameError: (v: string) => void;
  setPronouns: (v: string) => void;
  setGender: (v: string) => void;
  toggleSexuality: (v: string) => void;
  setSexuality: (v: string[]) => void;
  setEventAudience: (v: string) => void;
  setLinks: (updater: string[] | ((prev: string[]) => string[])) => void;
  setNewLink: (v: string) => void;
  setShowPronouns: (v: boolean) => void;
  setShowGender: (v: boolean) => void;
  setIsSaving: (v: boolean) => void;
  setNewAvatarUri: (v: string | null) => void;
  /** Hydrate from the authed user when the screen mounts. */
  hydrate: (init: {
    username: string;
    pronouns: string;
    gender: string;
    links: string[];
    sexuality?: string[];
    eventAudience?: string;
  }) => void;
  reset: () => void;
}

const initial = {
  username: "",
  usernameError: "",
  pronouns: "",
  gender: "",
  sexuality: [] as string[],
  eventAudience: "",
  links: [] as string[],
  newLink: "",
  showPronouns: false,
  showGender: false,
  isSaving: false,
  newAvatarUri: null as string | null,
};

export const useEditProfileUIStore = create<EditProfileUIState>((set) => ({
  ...initial,
  setUsername: (username) => set({ username }),
  setUsernameError: (usernameError) => set({ usernameError }),
  setPronouns: (pronouns) => set({ pronouns }),
  setGender: (gender) => set({ gender }),
  toggleSexuality: (v) =>
    set((s) => ({
      sexuality: s.sexuality.includes(v)
        ? s.sexuality.filter((i) => i !== v)
        : [...s.sexuality, v],
    })),
  setSexuality: (sexuality) => set({ sexuality }),
  setEventAudience: (eventAudience) => set({ eventAudience }),
  setLinks: (updater) =>
    set((s) => ({ links: typeof updater === "function" ? updater(s.links) : updater })),
  setNewLink: (newLink) => set({ newLink }),
  setShowPronouns: (showPronouns) => set({ showPronouns }),
  setShowGender: (showGender) => set({ showGender }),
  setIsSaving: (isSaving) => set({ isSaving }),
  setNewAvatarUri: (newAvatarUri) => set({ newAvatarUri }),
  hydrate: ({ username, pronouns, gender, links, sexuality, eventAudience }) =>
    set({
      username,
      pronouns,
      gender,
      links,
      sexuality: sexuality ?? [],
      eventAudience: eventAudience ?? "",
    }),
  reset: () => set(initial),
}));
