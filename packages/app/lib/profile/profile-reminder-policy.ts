/**
 * Profile-entry targeting. Keep this pure so auth, route and stale-profile
 * behaviour can be regression tested outside React/Next.
 *
 * A profile photo AND a first published post are required for every DVNT
 * member. The required dialog may cover ordinary app surfaces, but it must not
 * cover the exact completion screens, identity/legal flows, purchases, or
 * immersive calls. Server-side progress remains authoritative.
 */
export interface ReminderMember {
  id?: string | number | null;
  authId?: string | null;
  avatar?: string | null;
  postsCount?: number | null;
}
export interface ReminderNeeds {
  photo: boolean;
  firstPost: boolean;
}

export function missingProfileSteps(user: ReminderMember | null | undefined): ReminderNeeds {
  if (!user) return { photo: false, firstPost: false };
  return {
    photo: !String(user.avatar ?? "").trim(),
    firstPost: typeof user.postsCount === "number" && Number.isFinite(user.postsCount)
      ? user.postsCount === 0
      : false, // Unknown is not zero: authoritative server progress resolves it.
  };
}

export function canShowProfileReminderAt(pathname: string): boolean {
  if (!pathname || !pathname.startsWith("/")) return false;
  if (pathname === "/" || pathname === "/feed") return true;
  if (!pathname.startsWith("/feed/")) return false;
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  // Avoid checkout, sales, authentication, private/immersive sessions, and
  // screens where members are already completing a required action.
  const blocked = new Set([
    "checkout", "cart", "tickets", "ticket", "order", "purchase",
    "pay", "billing", "auth", "verify", "verification", "call",
    "video", "room", "sneaky-lynk", "story", "camera", "create",
    "edit", "onboarding", "payment", "live",
  ]);
  return !segments.some((s) => blocked.has(s));
}

/** A restricted member may enter only the screen needed for the next step. */
export function newMemberRedirect(
  step: "not_required" | "pending_verification" | "photo" | "first_post" | "complete",
  path: string,
): string | null {
  if (step === "not_required" || step === "complete" || step === "pending_verification") return null;
  // Existing ID/email verification, legal documents and ticket purchases stay
  // accessible. No profile gate may trap a member inside checkout.
  if (/^\/(?:auth|legal)(?:\/|$)/.test(path) ||
      /\/(?:checkout|payment|billing|tickets|ticket|orders)(?:\/|$)/.test(path)) return null;
  if (step === "photo") {
    return path === "/feed/onboarding/photo" ? null : "/feed/onboarding/photo";
  }
  return path === "/feed/create" || path.startsWith("/feed/camera")
    ? null : "/feed/create";
}
