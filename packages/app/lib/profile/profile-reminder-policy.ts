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

export function canShowProfileReminderAt(
  pathname: string,
  step?: "not_required" | "pending_verification" | "photo" | "first_post" | "complete",
): boolean {
  if (!pathname || !pathname.startsWith("/")) return false;
  const path = pathname.replace(/\/+$/, "") || "/";

  // Verification and legal documents must remain reachable throughout setup.
  if (/^\/(?:auth|legal)(?:\/|$)/.test(path) ||
      /^\/(?:privacy|terms)$/.test(path) ||
      /^\/settings\/(?:terms|privacy-policy|community-guidelines|ad-policy|eligibility|identity-protection)$/.test(path)) return false;

  // These exact screens own purchases or existing tickets. Event detail
  // contains the checkout sheet itself; event lists and management do not.
  if (/^\/(?:feed\/)?checkout(?:\/|$)/.test(path) ||
      /^\/feed\/(?:ticket|tickets)(?:\/|$)/.test(path) ||
      /^\/feed\/events\/my-tickets$/.test(path) ||
      /^\/feed\/events\/[1-9]\d*(?:\/embed\/checkout)?$/.test(path) ||
      /^\/events\/(?!create$)[^/]+$/.test(path) ||
      /^\/public\/events\/[1-9]\d*$/.test(path) ||
      /^\/public\/tickets\/(?:claim|guest)\/[^/]+$/.test(path) ||
      /^\/settings\/(?:purchases|payments|payment-methods|receipts|receipt-viewer|refund-request|refunds)$/.test(path) ||
      /^\/settings\/order\/[^/]+$/.test(path) ||
      path === "/feed/sneaky-lynk/billing") return false;

  // Only active immersive room screens are exempt, never room creation/lists.
  if (/^\/feed\/(?:call|lynk)\/[^/]+$/.test(path) ||
      /^\/feed\/sneaky-lynk\/room\/[^/]+$/.test(path) ||
      /^\/(?:video|game-night)\/room\/[^/]+$/.test(path) ||
      /^\/feed\/events\/[1-9]\d*\/live$/.test(path)) return false;

  // Completion screens are stage-specific. An unresolved read or a missing
  // photo cannot expose the first-post composer by entering its URL directly.
  if (path === "/feed/onboarding/photo") return false;
  if (step === "first_post" &&
      ["/feed/create", "/feed/camera", "/feed/crop-preview"].includes(path)) return false;

  // A mandatory entry gate covers every other signed-in frontend surface,
  // including ordinary routes outside /feed and generic create/edit screens.
  return true;
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

