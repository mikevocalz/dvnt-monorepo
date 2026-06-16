export type PublicGateReason =
  | "create"
  | "profile"
  | "messages"
  | "comments"
  | "post"
  | "activity"
  | "search"
  | "spicy"
  | "events"
  | "engage";

export interface PublicGateConfig {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: string;
  secondaryCta: string;
}

const DEFAULT_CTA = {
  primaryCta: "Create account",
  secondaryCta: "Sign in",
} as const;

const PUBLIC_GATE_CONFIG: Record<PublicGateReason, PublicGateConfig> = {
  create: {
    eyebrow: "WELCOME TO DVNT",
    title: "Got a look, a moment, or a vibe?",
    description:
      "Create your account to post photos, video, and text. Verification can come later when you're ready for private features.",
    ...DEFAULT_CTA,
  },
  profile: {
    eyebrow: "WHO'S OUTSIDE?",
    title: "Want to see who all is there?",
    description:
      "Create your account to open profiles, follow people, and keep up with the community beyond preview mode.",
    ...DEFAULT_CTA,
  },
  messages: {
    eyebrow: "PRIVATE CONNECTION",
    title: "Ready to connect one-on-one?",
    description:
      "Create your account first. Verification unlocks private messaging once you're ready to tap in deeper.",
    ...DEFAULT_CTA,
  },
  comments: {
    eyebrow: "JOIN THE CONVERSATION",
    title: "Want to join the conversation?",
    description:
      "Create your account to comment, reply, and participate. Verified access unlocks protected discussion surfaces.",
    ...DEFAULT_CTA,
  },
  post: {
    eyebrow: "TAP IN",
    title: "Explore now. Join when you're ready.",
    description:
      "You're in preview mode. Create your account to open full post details, react, and move through the app without soft gates.",
    ...DEFAULT_CTA,
  },
  activity: {
    eyebrow: "YOUR DVNT STARTS HERE",
    title: "Activity opens after signup.",
    description:
      "Create your account to save posts, track interactions, and pick up where you left off each time you come back.",
    ...DEFAULT_CTA,
  },
  search: {
    eyebrow: "DISCOVER WITH INTENTION",
    title: "Search unlocks after signup.",
    description:
      "Create your account to search people, tags, and conversations. Preview mode stays focused on feed, events, and read-only profiles.",
    ...DEFAULT_CTA,
  },
  spicy: {
    eyebrow: "VERIFIED ADULTS ONLY",
    title: "Some content is for verified adults only.",
    description:
      "Create your account first. Verification unlocks protected spicy content after age and identity checks are complete.",
    ...DEFAULT_CTA,
  },
  events: {
    eyebrow: "OUTSIDE TONIGHT?",
    title: "Browse the lineup now.",
    description:
      "Create your account to open full event details, RSVP, and buy tickets without leaving preview mode.",
    ...DEFAULT_CTA,
  },
  engage: {
    eyebrow: "REAL PEOPLE, REAL COMMUNITY",
    title: "Want to react and save your spot here?",
    description:
      "Create your account to like, save, and engage with the community. Verification unlocks the more private layers.",
    ...DEFAULT_CTA,
  },
};

export function getPublicGateConfig(reason: PublicGateReason): PublicGateConfig {
  return PUBLIC_GATE_CONFIG[reason];
}
