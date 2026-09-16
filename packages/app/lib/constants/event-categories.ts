/**
 * Event Category Presets
 *
 * Safe labeling for Apple Review compliance.
 * Canonical type stored in DB; display label shown in UI.
 */

export interface EventCategory {
  value: string;
  label: string;
  emoji?: string;
}

export const EVENT_CATEGORIES: EventCategory[] = [
  { value: "virtual_session", label: "Virtual Session", emoji: "💻" },
  { value: "party", label: "Party", emoji: "🎉" },
  { value: "picnic", label: "Picnic", emoji: "🧺" },
  { value: "game_night", label: "Game Night", emoji: "🎲" },
  { value: "panel", label: "Panel", emoji: "🎙️" },
  { value: "happy_hour", label: "Happy Hour", emoji: "🍸" },
  { value: "wine_down", label: "Wine Down", emoji: "🍷" },
  { value: "kickback", label: "Kickback", emoji: "🛋️" },
  { value: "spoken_word", label: "Spoken Word", emoji: "📝" },
  { value: "open_mic", label: "Open Mic", emoji: "🎤" },
  { value: "karaoke", label: "Karaoke", emoji: "🎵" },
  { value: "bike_ride", label: "Bike Ride", emoji: "🚴" },
  { value: "walk_run", label: "Walk/Run", emoji: "🏃" },
  { value: "fitness_training", label: "Fitness Training", emoji: "💪" },
  { value: "yoga", label: "Yoga", emoji: "🧘" },
  { value: "meditation", label: "Meditation", emoji: "🕯️" },
  { value: "side_session", label: "SIDE Session", emoji: "🔥" },
  { value: "midnight_fellowship", label: "Midnight Fellowship", emoji: "🌙" },
  { value: "fetish_demo", label: "Fetish Demo", emoji: "⚡" },
  { value: "training", label: "Training", emoji: "📚" },
  { value: "cooking_class", label: "Cooking Class", emoji: "👨‍🍳" },
  { value: "mixology", label: "Mixology", emoji: "🍹" },
  { value: "dance_class", label: "Dance Class", emoji: "💃" },
  { value: "other", label: "Other", emoji: "✨" },
];

// Visibility labels and helper text live in one module so the native and web
// create/edit screens cannot drift. Re-exported here for older import paths.
export {
  EVENT_VISIBILITY_COPY,
  EVENT_VISIBILITY_OPTIONS,
  eventVisibilityCopy,
} from "../events/event-visibility-copy";

export const AGE_RESTRICTION_OPTIONS = [
  { value: "none", label: "All Ages" },
  { value: "18+", label: "18+" },
  { value: "21+", label: "21+" },
] as const;

export function getCategoryLabel(value: string): string {
  return EVENT_CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function getCategoryEmoji(value: string): string {
  return EVENT_CATEGORIES.find((c) => c.value === value)?.emoji || "✨";
}
