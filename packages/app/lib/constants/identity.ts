/**
 * Identity + event-audience options collected in onboarding and editable on
 * the profile. Stored on users.sexuality (text[]) / users.event_audience —
 * private filter data for events and suggested profiles, never shown publicly.
 */
export const IDENTITY_OPTIONS = [
  "Lesbian",
  "Gay",
  "Bisexual",
  "Transgender",
  "Queer",
  "Questioning",
  "Intersex",
  "Asexual",
  "Pansexual",
] as const;

export const AUDIENCE_OPTIONS = [
  "Men",
  "Women",
  "Both (men & women)",
  "Trans-men",
  "Trans-women",
  "Non-binary",
  "Everyone (every gender)",
] as const;
