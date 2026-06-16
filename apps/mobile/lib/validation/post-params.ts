/**
 * Post Params Validation
 * 
 * Provides strict validation for post route parameters to prevent crashes
 * from undefined, null, or malformed IDs reaching the Post Detail screen.
 * 
 * CRITICAL: This validation MUST run BEFORE any React hooks in the screen component.
 */

/**
 * Validates if a value is a valid post ID.
 * 
 * Valid formats:
 * - Numeric string: "123", "456789"
 * - UUID: standard 36-character UUID string
 * 
 * Invalid:
 * - undefined, null, empty string
 * - Literal strings: "undefined", "null"
 * - Arrays (Expo Router edge case)
 * - Special characters that could be injection attempts
 */
export function isValidPostId(id: unknown): id is string {
  // Type check
  if (typeof id !== 'string') {
    if (__DEV__) console.warn('[isValidPostId] Not a string:', typeof id, id);
    return false;
  }
  
  // Empty check
  if (id.length === 0) {
    if (__DEV__) console.warn('[isValidPostId] Empty string');
    return false;
  }
  
  // Literal string checks
  if (id === 'undefined' || id === 'null' || id === 'NaN') {
    if (__DEV__) console.warn('[isValidPostId] Literal invalid string:', id);
    return false;
  }
  
  // Format validation: numeric OR UUID
  const isNumeric = /^\d+$/.test(id);
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  
  if (!isNumeric && !isUUID) {
    if (__DEV__) console.warn('[isValidPostId] Invalid format (not numeric or UUID):', id);
    return false;
  }
  
  return true;
}

/**
 * Result of post params validation
 */
export type PostParamsValidationResult =
  | { valid: true; postId: string }
  | { valid: false; error: string; rawValue: unknown };

/**
 * Validates and normalizes post route parameters.
 * 
 * Handles all edge cases:
 * - Missing params
 * - Array params (Expo Router can return string[])
 * - Invalid formats
 * - Type coercion issues
 * 
 * @param rawParams - Raw params from useLocalSearchParams()
 * @returns Validation result with either valid postId or error details
 */
export function validatePostParams(
  rawParams: Record<string, any>
): PostParamsValidationResult {
  const { id } = rawParams;
  
  // Check existence
  if (id === undefined || id === null) {
    return {
      valid: false,
      error: 'Missing post ID parameter',
      rawValue: id,
    };
  }
  
  // Handle array case (Expo Router edge case - can happen with malformed URLs)
  if (Array.isArray(id)) {
    if (id.length === 0) {
      return {
        valid: false,
        error: 'Post ID is empty array',
        rawValue: id,
      };
    }
    
    // Take first element
    const firstId = id[0];
    if (!isValidPostId(firstId)) {
      return {
        valid: false,
        error: `Invalid post ID in array: ${firstId}`,
        rawValue: id,
      };
    }
    
    if (__DEV__) {
      console.warn('[validatePostParams] Received array, using first element:', firstId);
    }
    
    return { valid: true, postId: String(firstId) };
  }
  
  // Convert to string (handles numbers, etc.)
  const idString = String(id);
  
  // Validate format
  if (!isValidPostId(idString)) {
    return {
      valid: false,
      error: `Invalid post ID format: ${idString}`,
      rawValue: id,
    };
  }
  
  return { valid: true, postId: idString };
}

/**
 * Dev-only assertion for post ID validity.
 * Throws in development, logs in production.
 * 
 * Use this in places where you expect the ID to ALWAYS be valid
 * (e.g., after validation has already passed).
 */
export function assertValidPostId(id: unknown, context: string): asserts id is string {
  if (!isValidPostId(id)) {
    const error = `[${context}] Invalid post ID: ${id}`;
    if (__DEV__) {
      throw new Error(error);
    } else {
      console.error(error);
    }
  }
}
