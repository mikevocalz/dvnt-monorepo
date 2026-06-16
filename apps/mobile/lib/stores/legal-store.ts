import { create } from "zustand";
import { LEGAL_CONTENT } from "@/lib/constants/legal-content";

export type LegalPageSlug =
  | "about"
  | "privacy-policy"
  | "terms-of-service"
  | "community-standards"
  | "faq"
  | "eligibility"
  | "identity-protection"
  | "ad-policy";

export interface LegalPage {
  id: string;
  slug: LegalPageSlug;
  title: string;
  subtitle?: string;
  content: string;
  lastUpdated: string;
  effectiveDate?: string;
}

export interface FAQItem {
  question: string;
  answer: string;
  category?: string;
}

export interface LegalPageWithFAQ extends LegalPage {
  faqs?: FAQItem[];
}

interface LegalState {
  pages: Record<LegalPageSlug, LegalPageWithFAQ | null>;
  loading: Record<LegalPageSlug, boolean>;
  errors: Record<LegalPageSlug, string | null>;
  fetchPage: (slug: LegalPageSlug) => Promise<void>;
  getPage: (slug: LegalPageSlug) => LegalPageWithFAQ | null;
  isLoading: (slug: LegalPageSlug) => boolean;
  getError: (slug: LegalPageSlug) => string | null;
}

export const useLegalStore = create<LegalState>((set, get) => ({
  pages: {
    about: null,
    "privacy-policy": null,
    "terms-of-service": null,
    "community-standards": null,
    faq: null,
    eligibility: null,
    "identity-protection": null,
    "ad-policy": null,
  },
  loading: {
    about: false,
    "privacy-policy": false,
    "terms-of-service": false,
    "community-standards": false,
    faq: false,
    eligibility: false,
    "identity-protection": false,
    "ad-policy": false,
  },
  errors: {
    about: null,
    "privacy-policy": null,
    "terms-of-service": null,
    "community-standards": null,
    faq: null,
    eligibility: null,
    "identity-protection": null,
    "ad-policy": null,
  },

  fetchPage: async (slug: LegalPageSlug) => {
    const state = get();

    // Don't refetch if already loaded with valid content
    const existingPage = state.pages[slug];
    if (existingPage && existingPage.content && existingPage.content.trim().length > 0) {
      return;
    }
    
    // Don't refetch if currently loading
    if (state.loading[slug]) {
      return;
    }

    set((s) => ({
      loading: { ...s.loading, [slug]: true },
      errors: { ...s.errors, [slug]: null },
    }));

    // Load directly from static content - it's bundled and reliable
    const staticContent = LEGAL_CONTENT[slug as keyof typeof LEGAL_CONTENT];
    if (staticContent && staticContent.content) {
      console.log("[LegalStore] ✓ Loaded static content for:", slug);
      set((s) => ({
        pages: { ...s.pages, [slug]: staticContent as LegalPageWithFAQ },
        loading: { ...s.loading, [slug]: false },
        errors: { ...s.errors, [slug]: null },
      }));
      return;
    }

    // No content available
    console.error("[LegalStore] No content found for:", slug);
    set((s) => ({
      loading: { ...s.loading, [slug]: false },
      errors: { ...s.errors, [slug]: "Content not available" },
    }));
  },

  getPage: (slug: LegalPageSlug) => get().pages[slug],
  isLoading: (slug: LegalPageSlug) => get().loading[slug],
  getError: (slug: LegalPageSlug) => get().errors[slug],
}));
