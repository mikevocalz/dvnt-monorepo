/**
 * Privileged API Layer
 *
 * This module provides typed wrappers for all privileged database operations.
 * All writes to sensitive tables (users, posts, stories, events, messages, etc.)
 * MUST go through these wrappers.
 *
 * Each wrapper:
 * 1. Gets the Better Auth token
 * 2. Calls the appropriate Edge Function
 * 3. Returns typed response data
 *
 * NEVER call supabase.from("sensitive_table").insert/update/delete directly!
 * Use these wrappers instead.
 */

import { supabase } from "../../supabase/client";
import {
  requireBetterAuthToken,
  updateUserRowCache,
  clearUserRowCache,
} from "../../auth/identity";
import type { AppUser } from "../../auth-client";

// ============================================================================
// Types
// ============================================================================

interface PrivilegedResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// Profile types
export interface UpdateProfileInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  location?: string;
  website?: string;
  links?: string[];
  avatarUrl?: string;
  pronouns?: string;
  gender?: string;
}

// Post types
export interface CreatePostInput {
  content: string;
  kind?: "media" | "text";
  textTheme?: import("@/lib/types").TextPostThemeKey;
  mediaUrls?: string[];
  location?: string;
  visibility?: "public" | "followers" | "private";
  isNsfw?: boolean;
}

export interface UpdatePostInput {
  content?: string;
  location?: string;
  visibility?: "public" | "followers" | "private";
  isNsfw?: boolean;
}

// Story types
export interface CreateStoryInput {
  mediaUrl: string;
  mediaType: "image" | "video";
  duration?: number; // seconds for video
}

// Event types
export interface CreateEventInput {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: string;
  coverImageUrl?: string;
  isPublic?: boolean;
  maxAttendees?: number;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  coverImageUrl?: string;
  isPublic?: boolean;
  maxAttendees?: number;
}

export interface RsvpEventInput {
  eventId: number;
  status: "going" | "interested" | "not_going";
}

// Message types
export interface SendMessageInput {
  conversationId: number;
  body: string;
  mediaUrl?: string;
}

// Group types
export interface CreateGroupInput {
  name: string;
  description?: string;
  memberIds: number[];
}

export interface AddMemberInput {
  conversationId: number;
  userId: number;
}

export interface RemoveMemberInput {
  conversationId: number;
  userId: number;
}

export interface ChangeRoleInput {
  conversationId: number;
  userId: number;
  role: "admin" | "moderator" | "member";
}

// ============================================================================
// Helper
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeEdgeFunction<T>(
  functionName: string,
  body: any,
): Promise<T> {
  const token = await requireBetterAuthToken();

  const { data, error } = await supabase.functions.invoke<
    PrivilegedResponse<T>
  >(functionName, {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) {
    console.error(`[Privileged] ${functionName} error:`, error);
    throw new Error(error.message || `Failed to call ${functionName}`);
  }

  if (!data?.ok) {
    const errorMessage = data?.error?.message || `${functionName} failed`;
    console.error(`[Privileged] ${functionName} failed:`, errorMessage);
    throw new Error(errorMessage);
  }

  return data.data as T;
}

// ============================================================================
// Auth Sync
// ============================================================================

/**
 * Sync the current Better Auth user to the Supabase users table.
 * Call this after login to ensure we have a valid user row.
 */
export async function syncAuthUser(): Promise<AppUser> {
  console.log("[Privileged] syncAuthUser");
  const result = await invokeEdgeFunction<{ user: AppUser; action: string }>(
    "auth-sync",
    {},
  );
  console.log("[Privileged] syncAuthUser result:", result.action);
  return result.user;
}

// ============================================================================
// Profile
// ============================================================================

/**
 * Update the current user's profile.
 */
export async function updateProfile(
  input: UpdateProfileInput,
): Promise<AppUser> {
  console.log("[Privileged] updateProfile:", input);
  const result = await invokeEdgeFunction<{ user: AppUser }>(
    "update-profile",
    input,
  );

  // Update cache
  updateUserRowCache({
    firstName: input.firstName || input.name || undefined,
    lastName: input.lastName || undefined,
    bio: input.bio || undefined,
    location: input.location || undefined,
  });

  return result.user;
}

// ============================================================================
// Posts
// ============================================================================

/**
 * Create a new post.
 */
export async function createPost(
  input: CreatePostInput,
): Promise<{ post: any }> {
  console.log("[Privileged] createPost");
  return invokeEdgeFunction<{ post: any }>("create-post", input);
}

/**
 * Update an existing post.
 */
export async function updatePost(
  postId: number,
  input: UpdatePostInput,
): Promise<{ post: any }> {
  console.log("[Privileged] updatePost:", postId);
  return invokeEdgeFunction<{ post: any }>("update-post", { postId, ...input });
}

/**
 * Delete a post (soft delete).
 */
export async function deletePost(
  postId: number,
): Promise<{ success: boolean }> {
  console.log("[Privileged] deletePost:", postId);
  return invokeEdgeFunction<{ success: boolean }>("delete-post", { postId });
}

/**
 * Like or unlike a post.
 */
export async function togglePostLike(
  postId: number,
): Promise<{ liked: boolean; likesCount: number }> {
  console.log("[Privileged] togglePostLike:", postId);
  return invokeEdgeFunction<{ liked: boolean; likesCount: number }>(
    "toggle-post-like",
    { postId },
  );
}

// ============================================================================
// Stories
// ============================================================================

/**
 * Create a new story.
 */
export async function createStory(
  input: CreateStoryInput,
): Promise<{ story: any }> {
  console.log("[Privileged] createStory");
  return invokeEdgeFunction<{ story: any }>("create-story", input);
}

/**
 * Delete a story.
 */
export async function deleteStory(
  storyId: number,
): Promise<{ success: boolean }> {
  console.log("[Privileged] deleteStory:", storyId);
  return invokeEdgeFunction<{ success: boolean }>("delete-story", { storyId });
}

// ============================================================================
// Events
// ============================================================================

/**
 * Create a new event.
 */
export async function createEvent(
  input: CreateEventInput,
): Promise<{ event: any }> {
  console.log("[Privileged] createEvent");
  return invokeEdgeFunction<{ event: any }>("create-event", input);
}

/**
 * Update an existing event.
 */
export async function updateEvent(
  eventId: number,
  input: UpdateEventInput,
): Promise<{ event: any }> {
  console.log("[Privileged] updateEvent:", eventId);
  return invokeEdgeFunction<{ event: any }>("update-event", {
    eventId,
    ...input,
  });
}

/**
 * Delete an event.
 */
export async function deleteEvent(
  eventId: number,
): Promise<{ success: boolean }> {
  console.log("[Privileged] deleteEvent:", eventId);
  return invokeEdgeFunction<{ success: boolean }>("delete-event", { eventId });
}

/**
 * Cancel a published event. Use this instead of deleteEvent when the
 * event has active ticket buyers — the server cascades Stripe refunds
 * (one idempotent call per unique payment_intent), voids free tickets,
 * pushes notifications to every affected user, and marks the event
 * `status='cancelled'`. The event row is preserved for the audit trail.
 *
 * delete-event will REJECT with `tickets_exist` if you try to hard-
 * delete an event that has any non-terminal tickets. Use this fn first;
 * fall back to deleteEvent only when this returns affectedTickets=0.
 */
export interface CancelEventResult {
  ok: boolean;
  eventId: number;
  refundsIssued: number;
  refundsFailed: number;
  freeTicketsVoided: number;
  affectedTickets: number;
  alreadyCancelled?: boolean;
}
export async function cancelEvent(
  eventId: number,
  reason?: string,
): Promise<CancelEventResult> {
  console.log("[Privileged] cancelEvent:", eventId, "reason:", reason ?? "—");
  return invokeEdgeFunction<CancelEventResult>("cancel-event", {
    eventId,
    reason: reason || undefined,
  });
}

/**
 * Co-organizer (staff) management. Each event has one owner
 * (events.host_id) plus optional invited co-organizers stored in
 * event_co_organizers with a role enum: scanner / editor / admin.
 *
 * - scanner: can check in tickets at the door, sees PII-redacted roster
 * - editor:  scanner + full roster + analytics + refunds
 * - admin:   editor + can manage other staff (invite/revoke scanner+editor)
 * - owner:   admin + can grant admin role, transfer ownership
 */
export type CoOrgRole = "scanner" | "editor" | "admin";

export interface HostDashboardEvent {
  id: number;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  status: string;
  total_attendees: number | null;
  capacity: number | null;
  sold_count: number;
  scanned_count: number;
  gross_cents: number;
}

export interface HostDashboard {
  ok: boolean;
  stats: {
    monthSold: number;
    monthRevenueCents: number;
    scanRate: number | null;
  };
  tonight: HostDashboardEvent[];
  upcoming: HostDashboardEvent[];
  drafts: HostDashboardEvent[];
  past: HostDashboardEvent[];
}

export async function getHostDashboard(): Promise<HostDashboard> {
  return invokeEdgeFunction<HostDashboard>("get-host-dashboard", {});
}

/**
 * Download the event attendee roster as a CSV. Returns raw CSV text +
 * the server-suggested filename. Server enforces owner / admin / editor
 * role — scanners are denied. Callers should save the CSV to a file and
 * hand it to expo-sharing for a system share sheet.
 */
export async function exportEventAttendeesCsv(eventId: number): Promise<{
  csv: string;
  filename: string;
}> {
  const token = await requireBetterAuthToken();
  const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "https://npfjanxturvmjyevoyfo.supabase.co";
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

  const res = await fetch(
    `${supabaseUrl}/functions/v1/export-event-attendees`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_id: eventId }),
    },
  );

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
    } catch {
      // non-JSON error body — swallow
    }
    throw new Error(message);
  }

  const csv = await res.text();
  // Pull filename from Content-Disposition if present.
  const cd = res.headers.get("content-disposition") || "";
  const match = cd.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `event-${eventId}-attendees.csv`;
  return { csv, filename };
}

export type BroadcastAudience = "all" | "scanned" | "unscanned";

export interface CompResult {
  issued: number;
  skipped: { recipient: string; reason: string }[];
  tier?: string;
}

/**
 * Bulk-issue free tickets to a list of usernames/emails. Owner or
 * admin only. Server enforces tier capacity + skips dupes.
 */
export async function bulkCompTickets(
  eventId: number,
  tierId: string,
  recipients: string[],
  note?: string,
): Promise<CompResult> {
  return invokeEdgeFunction<CompResult>("bulk-comp-tickets", {
    event_id: eventId,
    tier_id: tierId,
    recipients,
    note,
  });
}

export interface RefundResult {
  refunded: number;
  voided: number;
  failures: { ticketId: string; error: string }[];
}

/**
 * Bulk-refund tickets. Owner only. Paid tickets go through Stripe
 * (per-ticket idempotency). Free tickets are voided directly.
 */
export async function bulkRefundTickets(
  eventId: number,
  ticketIds: string[],
  reason?: string,
): Promise<RefundResult> {
  return invokeEdgeFunction<RefundResult>("bulk-refund-tickets", {
    event_id: eventId,
    ticket_ids: ticketIds,
    reason,
  });
}

/**
 * Send a push + activity-feed broadcast to every attendee of an event.
 * Owner or accepted admin only. Editors and scanners are denied
 * server-side. Rate-limited to 3 per 5 minutes per (sender, event).
 */
export async function sendEventBroadcast(
  eventId: number,
  message: string,
  audience: BroadcastAudience = "all",
  title?: string,
): Promise<{ notified: number; pushed: number; audience: BroadcastAudience }> {
  return invokeEdgeFunction("event-broadcast-message", {
    event_id: eventId,
    body: message,
    audience,
    title,
  });
}

export interface StaffEntry {
  inviteId: string | null;
  authId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "editor" | "scanner";
  accepted: boolean;
  invitedBy: string | null;
}

export async function getEventStaff(
  eventId: number,
): Promise<{
  ok: boolean;
  staff: StaffEntry[];
  callerRole: "owner" | "admin" | null;
}> {
  return invokeEdgeFunction("get-event-staff", { event_id: eventId });
}

export async function inviteCoOrganizer(
  eventId: number,
  username: string,
  role: CoOrgRole,
): Promise<{ ok: boolean; invite_id?: string; reinvited?: boolean }> {
  return invokeEdgeFunction("invite-co-organizer", {
    action: "invite",
    event_id: eventId,
    username,
    role,
  });
}

export async function acceptCoOrganizerInvite(
  inviteId: string,
): Promise<{ ok: boolean; alreadyAccepted?: boolean }> {
  return invokeEdgeFunction("invite-co-organizer", {
    action: "accept",
    invite_id: inviteId,
  });
}

export async function declineCoOrganizerInvite(
  inviteId: string,
): Promise<{ ok: boolean }> {
  return invokeEdgeFunction("invite-co-organizer", {
    action: "decline",
    invite_id: inviteId,
  });
}

export async function revokeCoOrganizer(
  inviteId: string,
): Promise<{ ok: boolean }> {
  return invokeEdgeFunction("invite-co-organizer", {
    action: "revoke",
    invite_id: inviteId,
  });
}

/**
 * RSVP to an event.
 */
export async function rsvpEvent(input: RsvpEventInput): Promise<{ rsvp: any }> {
  console.log("[Privileged] rsvpEvent:", input.eventId, input.status);
  return invokeEdgeFunction<{ rsvp: any }>("rsvp-event", input);
}

// ============================================================================
// Messaging
// ============================================================================

/**
 * Send a message in a conversation.
 */
export async function sendMessage(
  input: SendMessageInput,
): Promise<{ message: any }> {
  console.log(
    "[Privileged] sendMessage to conversation:",
    input.conversationId,
  );
  return invokeEdgeFunction<{ message: any }>("send-message", input);
}

/**
 * Delete a message (soft delete).
 */
export async function deleteMessage(
  messageId: number,
): Promise<{ success: boolean }> {
  console.log("[Privileged] deleteMessage:", messageId);
  return invokeEdgeFunction<{ success: boolean }>("delete-message", {
    messageId,
  });
}

/**
 * Get unread message counts.
 */
export async function getUnreadCounts(): Promise<{
  inbox: number;
  spam: number;
}> {
  console.log("[Privileged] getUnreadCounts");
  return invokeEdgeFunction<{ inbox: number; spam: number }>(
    "unread-counts",
    {},
  );
}

// ============================================================================
// Groups
// ============================================================================

/**
 * Create a new group conversation.
 */
export async function createGroup(
  input: CreateGroupInput,
): Promise<{ conversation: any }> {
  console.log("[Privileged] createGroup:", input.name);
  return invokeEdgeFunction<{ conversation: any }>("create-group", input);
}

/**
 * Add a member to a group.
 */
export async function addMember(
  input: AddMemberInput,
): Promise<{ success: boolean }> {
  console.log(
    "[Privileged] addMember:",
    input.userId,
    "to",
    input.conversationId,
  );
  return invokeEdgeFunction<{ success: boolean }>("add-member", input);
}

/**
 * Remove a member from a group.
 */
export async function removeMember(
  input: RemoveMemberInput,
): Promise<{ success: boolean }> {
  console.log(
    "[Privileged] removeMember:",
    input.userId,
    "from",
    input.conversationId,
  );
  return invokeEdgeFunction<{ success: boolean }>("remove-member", input);
}

/**
 * Change a member's role in a group.
 */
export async function changeRole(
  input: ChangeRoleInput,
): Promise<{ success: boolean }> {
  console.log("[Privileged] changeRole:", input.userId, "to", input.role);
  return invokeEdgeFunction<{ success: boolean }>("change-role", input);
}

// ============================================================================
// Video
// ============================================================================

/**
 * Join a video room and get provider token.
 */
export async function videoJoin(conversationId: number): Promise<{
  token: string;
  roomId: string;
  provider: string;
}> {
  console.log("[Privileged] videoJoin:", conversationId);
  return invokeEdgeFunction<{
    token: string;
    roomId: string;
    provider: string;
  }>("video-join", { conversationId });
}

// ============================================================================
// Follows
// ============================================================================

/**
 * Follow or unfollow a user.
 */
export async function toggleFollow(
  targetUserId: number,
): Promise<{ following: boolean }> {
  console.log("[Privileged] toggleFollow:", targetUserId);
  return invokeEdgeFunction<{ following: boolean }>("toggle-follow", {
    targetUserId,
  });
}

// ============================================================================
// Comments
// ============================================================================

/**
 * Add a comment to a post.
 */
export async function addComment(
  postId: number,
  content: string,
): Promise<{ comment: any }> {
  console.log("[Privileged] addComment to post:", postId);
  return invokeEdgeFunction<{ comment: any }>("add-comment", {
    postId,
    content,
  });
}

/**
 * Delete a comment.
 */
export async function deleteComment(
  commentId: number,
): Promise<{ success: boolean }> {
  console.log("[Privileged] deleteComment:", commentId);
  return invokeEdgeFunction<{ success: boolean }>("delete-comment", {
    commentId,
  });
}

// ============================================================================
// Blocks
// ============================================================================

/**
 * Block or unblock a user.
 */
export async function toggleBlock(
  targetUserId: number,
): Promise<{ blocked: boolean }> {
  console.log("[Privileged] toggleBlock:", targetUserId);
  return invokeEdgeFunction<{ blocked: boolean }>("toggle-block", {
    targetUserId,
  });
}
