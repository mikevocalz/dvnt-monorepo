/**
 * Safe Upload Utility
 * 
 * CRITICAL: Uploads must NEVER fail silently.
 * Every failure must:
 * 1. Show a toast to the user
 * 2. Log the error with context
 * 3. Return a clear failure result
 * 
 * This utility wraps the media upload hook to ensure consistent error handling.
 */

import { useUIStore } from "@/lib/stores/ui-store";

export interface SafeUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Validate that a URL is not empty before using it.
 * 
 * DEV mode: Throws an error if URL is empty
 * PROD mode: Logs warning and returns false
 */
export function assertValidUrl(url: string | undefined | null, context: string): boolean {
  if (!url || url.trim() === "") {
    const message = `[SafeUpload] INVARIANT VIOLATION: Empty URL in ${context}`;
    console.error(message);
    
    if (__DEV__) {
      throw new Error(message);
    }
    
    return false;
  }
  
  // Validate URL format
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    const message = `[SafeUpload] INVARIANT VIOLATION: Invalid URL format in ${context}: ${url.slice(0, 50)}`;
    console.error(message);
    
    if (__DEV__) {
      throw new Error(message);
    }
    
    return false;
  }
  
  return true;
}

/**
 * Log upload attempt with context
 */
export function logUploadAttempt(
  context: string,
  fileUri: string,
  folder: string,
): void {
  if (__DEV__) {
    console.log(`[SafeUpload] ${context}: Starting upload`, {
      fileUri: fileUri.slice(0, 50),
      folder,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Log upload success with result
 */
export function logUploadSuccess(
  context: string,
  url: string,
): void {
  if (__DEV__) {
    console.log(`[SafeUpload] ${context}: Upload successful`, {
      url: url.slice(0, 80),
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Log upload failure with error details
 */
export function logUploadFailure(
  context: string,
  error: unknown,
  fileUri?: string,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[SafeUpload] ${context}: Upload FAILED`, {
    error: errorMessage,
    fileUri: fileUri?.slice(0, 50),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Show upload error toast to user
 */
export function showUploadErrorToast(
  showToast: ReturnType<typeof useUIStore.getState>["showToast"],
  context: string,
  error?: string,
): void {
  const message = error || "Upload failed. Please try again.";
  showToast("error", `${context} Failed`, message);
}

/**
 * Validate upload result and show appropriate feedback
 * 
 * @returns The URL if valid, null if invalid
 */
export function validateUploadResult(
  result: { success: boolean; url?: string; error?: string },
  context: string,
  showToast?: ReturnType<typeof useUIStore.getState>["showToast"],
): string | null {
  if (!result.success) {
    logUploadFailure(context, result.error || "Unknown error");
    if (showToast) {
      showUploadErrorToast(showToast, context, result.error);
    }
    return null;
  }
  
  if (!assertValidUrl(result.url, context)) {
    if (showToast) {
      showUploadErrorToast(showToast, context, "Upload returned empty URL");
    }
    return null;
  }
  
  logUploadSuccess(context, result.url!);
  return result.url!;
}

/**
 * Assert that avatar URL is valid after update
 * 
 * CRITICAL: Prevents saving null/empty avatar URLs to user profile
 */
export function assertAvatarUrlAfterUpdate(
  avatarUrl: string | undefined | null,
  userId: string,
): void {
  if (!avatarUrl || avatarUrl.trim() === "") {
    const message = `[SafeUpload] INVARIANT: Avatar URL is null/empty after update for user ${userId}`;
    console.error(message);
    
    if (__DEV__) {
      throw new Error(message);
    }
  }
}

/**
 * Check if a file URI is a local file (needs upload) vs remote URL (already uploaded)
 */
export function isLocalFileUri(uri: string): boolean {
  return uri.startsWith("file://") || 
         uri.startsWith("content://") || 
         uri.startsWith("ph://") ||
         uri.startsWith("assets-library://");
}

/**
 * Check if a URL is a valid remote URL
 */
export function isRemoteUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Separate local files from remote URLs in an array
 */
export function separateLocalAndRemote(uris: string[]): {
  local: string[];
  remote: string[];
} {
  return {
    local: uris.filter(isLocalFileUri),
    remote: uris.filter(isRemoteUrl),
  };
}
