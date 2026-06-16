/**
 * Client-Side Validation Guards
 * 
 * PHASE 1: These guards enforce data contract invariants on the client
 * to prevent invalid API calls before they reach the server.
 * 
 * Server MUST also enforce these - client guards are defense-in-depth.
 */

/**
 * Validate that a user is 18+ based on DOB
 */
export function validateAge(dateOfBirth: Date | string): {
  valid: boolean;
  age: number;
  error?: string;
} {
  const dob = typeof dateOfBirth === "string" ? new Date(dateOfBirth) : dateOfBirth;
  
  if (isNaN(dob.getTime())) {
    return { valid: false, age: 0, error: "Invalid date of birth" };
  }
  
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  if (age < 18) {
    return { valid: false, age, error: "Must be 18 or older" };
  }
  
  return { valid: true, age };
}

/**
 * Validate comment depth - max 2 levels
 * 
 * Invariant: if parentComment has a parent → reject
 */
export function validateCommentDepth(
  parentComment: { id: string; parentId?: string | null } | null
): { valid: boolean; error?: string } {
  if (!parentComment) {
    // Top-level comment - always valid
    return { valid: true };
  }
  
  if (parentComment.parentId) {
    // Parent already has a parent - this would be level 3+
    return { 
      valid: false, 
      error: "Replies can only be 2 levels deep" 
    };
  }
  
  return { valid: true };
}

/**
 * Validate caption length
 */
export function validateCaption(caption: string | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!caption) {
    return { valid: true }; // Caption is optional
  }
  
  const MAX_CAPTION_LENGTH = 2200;
  
  if (caption.length > MAX_CAPTION_LENGTH) {
    return { 
      valid: false, 
      error: `Caption must be ${MAX_CAPTION_LENGTH} characters or less` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate comment content
 */
export function validateCommentContent(content: string): {
  valid: boolean;
  error?: string;
} {
  if (!content || content.trim().length === 0) {
    return { valid: false, error: "Comment cannot be empty" };
  }
  
  const MAX_COMMENT_LENGTH = 1000;
  
  if (content.length > MAX_COMMENT_LENGTH) {
    return { 
      valid: false, 
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate username format
 */
export function validateUsername(username: string): {
  valid: boolean;
  error?: string;
} {
  if (!username) {
    return { valid: false, error: "Username is required" };
  }
  
  const MIN_LENGTH = 3;
  const MAX_LENGTH = 30;
  const VALID_PATTERN = /^[a-zA-Z0-9_]+$/;
  
  if (username.length < MIN_LENGTH) {
    return { valid: false, error: `Username must be at least ${MIN_LENGTH} characters` };
  }
  
  if (username.length > MAX_LENGTH) {
    return { valid: false, error: `Username must be ${MAX_LENGTH} characters or less` };
  }
  
  if (!VALID_PATTERN.test(username)) {
    return { valid: false, error: "Username can only contain letters, numbers, and underscores" };
  }
  
  return { valid: true };
}

/**
 * Check if a story is expired
 * 
 * Invariant: Stories expire 24 hours after creation
 */
export function isStoryExpired(createdAt: Date | string): boolean {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const now = new Date();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  
  return (now.getTime() - created.getTime()) > TWENTY_FOUR_HOURS_MS;
}

/**
 * Validate media URL
 */
export function validateMediaUrl(url: string | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!url) {
    return { valid: false, error: "Media URL is required" };
  }
  
  if (!url.startsWith("https://")) {
    return { valid: false, error: "Media URL must use HTTPS" };
  }
  
  return { valid: true };
}

/**
 * Idempotent action result type
 * Used to standardize responses from like/bookmark/follow actions
 */
export type IdempotentActionResult = {
  success: boolean;
  action: "created" | "already_exists" | "deleted" | "not_found";
  data?: unknown;
};

/**
 * Guard: Prevent self-follow
 */
export function canFollowUser(
  currentUserId: string | undefined,
  targetUserId: string
): { valid: boolean; error?: string } {
  if (!currentUserId) {
    return { valid: false, error: "Must be logged in to follow" };
  }
  
  if (currentUserId === targetUserId) {
    return { valid: false, error: "Cannot follow yourself" };
  }
  
  return { valid: true };
}
