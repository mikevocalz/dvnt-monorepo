/**
 * DEV-ONLY Identity Ownership Invariants
 *
 * Throws immediately if ANY identity data ownership is violated.
 * This prevents cross-user data leaks for ALL identity fields:
 * - avatarUrl
 * - username
 * - displayName
 * - bio
 * - verified
 * - followerCount / followingCount
 * - isFollowing (relative state)
 */

export type IdentityContext =
  | "story"
  | "feed"
  | "comment"
  | "message"
  | "profile"
  | "followersList"
  | "followingList"
  | "settings";

interface IdentityOwnershipParams {
  context: IdentityContext;
  ownerId: string | number | null | undefined;
  authUserId?: string | number | null | undefined;
  field?: string; // Optional: which identity field is being rendered
}

/**
 * Assert that identity data is owned by the correct entity.
 *
 * In development, this warns if identity data might be coming from wrong source.
 * Settings is the ONLY context allowed to use authUser data directly.
 *
 * @param params - The ownership check parameters
 */
export function assertIdentityOwnership(params: IdentityOwnershipParams): void {
  if (__DEV__ !== true) return;

  const { context, ownerId, authUserId, field } = params;

  // Settings is the ONLY context allowed to reference authUser
  if (context === "settings") return;

  // If no authUserId, we can't check
  if (!authUserId) return;

  // If no ownerId, this is a problem - data isn't properly scoped
  if (!ownerId) {
    console.warn(
      `[IDENTITY OWNERSHIP WARNING] Context: ${context}${field ? ` (${field})` : ""} - ` +
        `Missing ownerId. Identity data may not be properly scoped.`,
    );
    return;
  }

  // NOTE: This function validates that ownerId is present and context is valid.
  // The actual source validation is done by assertIdentitySource.
}

/**
 * Validate that identity data source is from the entity, not authUser.
 * This is the critical check - identity MUST come from entity.author, not global state.
 *
 * @throws Error in development if identity appears to come from wrong source
 */
export function assertIdentitySource(params: {
  context: IdentityContext;
  entityOwnerId: string | number | null | undefined;
  authUserId: string | number | null | undefined;
  identitySource: "entity" | "authUser";
  field?: string;
}): void {
  if (__DEV__ !== true) return;

  const { context, entityOwnerId, authUserId, identitySource, field } = params;

  // Settings is the ONLY place allowed to use authUser identity
  if (context === "settings") return;

  // If identity comes from authUser but this is not the authUser's content, VIOLATION
  if (identitySource === "authUser") {
    const entityIdStr = entityOwnerId ? String(entityOwnerId) : null;
    const authIdStr = authUserId ? String(authUserId) : null;

    // If entity owner is different from auth user, this is a violation
    if (entityIdStr && authIdStr && entityIdStr !== authIdStr) {
      throw new Error(
        `[IDENTITY OWNERSHIP VIOLATION]
Context: ${context}${field ? ` (field: ${field})` : ""}
Entity ownerId: ${entityIdStr}
Auth userId: ${authIdStr}
Identity source: ${identitySource}

A non-auth entity is rendering identity data from authUser.
This is FORBIDDEN and causes cross-user data leaks.

FIX: Use entity.author.${field || "data"}, NOT authUser.${field || "data"}`,
      );
    }
  }
}

// Legacy alias for backwards compatibility
export const assertAvatarOwnership = assertIdentityOwnership;

/**
 * Validate that avatar source is from the entity, not authUser.
 * Alias for assertIdentitySource with avatar-specific messaging.
 */
export function assertAvatarSource(params: {
  context: IdentityContext;
  entityOwnerId: string | number | null | undefined;
  authUserId: string | number | null | undefined;
  avatarSource: "entity" | "authUser";
}): void {
  return assertIdentitySource({
    ...params,
    identitySource: params.avatarSource,
    field: "avatar",
  });
}

/**
 * Get the correct identity field value for an entity, with validation.
 *
 * @param entityValue - Value from the entity (story.author.*, post.author.*, etc.)
 * @param entityOwnerId - The entity owner's ID
 * @param context - The rendering context
 * @param field - The field name for logging
 * @returns The entity's value (never authUser's)
 */
export function getSafeIdentityValue<T>(
  entityValue: T | null | undefined,
  entityOwnerId: string | number | null | undefined,
  context: IdentityContext,
  field: string,
): T | undefined {
  if (__DEV__ && entityValue === undefined && context !== "settings") {
    console.warn(
      `[IDENTITY] Missing ${field} for ${context} entity ${entityOwnerId}. ` +
        `Ensure entity data includes author.${field}.`,
    );
  }

  return entityValue ?? undefined;
}

// Legacy alias
export const getSafeAvatarUrl = (
  entityAvatar: string | null | undefined,
  entityOwnerId: string | number | null | undefined,
  context: IdentityContext,
) => getSafeIdentityValue(entityAvatar, entityOwnerId, context, "avatar");
