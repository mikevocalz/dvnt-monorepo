/**
 * Route Registry
 * Complete inventory of all app routes with their deep link mappings,
 * auth requirements, and parameter schemas.
 */

import { z } from "zod";
import { getLynkDisplayName } from "@/lib/branding/lynk-branding";

export type RouteAuth = "public" | "auth-required";

export interface RouteEntry {
  /** URL path pattern for matching (e.g. /u/:username) */
  urlPattern: string;
  /** Expo Router path to navigate to */
  routerPath: string;
  /** Auth requirement */
  auth: RouteAuth;
  /** Zod schema for params validation */
  paramsSchema?: z.ZodObject<any>;
  /** Human-readable label */
  label: string;
}

// ── Param Schemas ────────────────────────────────────────────────────

const usernameSchema = z.object({ username: z.string().min(1) });
const idSchema = z.object({ id: z.string().min(1) });
const postIdSchema = z.object({ postId: z.string().min(1) });
const commentIdSchema = z.object({ commentId: z.string().min(1) });
const roomIdSchema = z.object({ roomId: z.string().min(1) });
const tokenSchema = z.object({ token: z.string().min(1) });

// ── Route Registry ───────────────────────────────────────────────────
// Maps external URL paths → Expo Router paths
// Order matters: more specific patterns first

export const ROUTE_REGISTRY: RouteEntry[] = [
  // ── Auth routes (public) ───────────────────────────────────────────
  {
    urlPattern: "/auth/reset",
    routerPath: "/(auth)/reset-password",
    auth: "public",
    paramsSchema: tokenSchema,
    label: "Reset Password",
  },
  {
    urlPattern: "/reset-password",
    routerPath: "/(auth)/reset-password",
    auth: "public",
    paramsSchema: tokenSchema,
    label: "Reset Password (legacy alias)",
  },
  {
    urlPattern: "/auth/verify",
    routerPath: "/(auth)/verify-email",
    auth: "public",
    paramsSchema: tokenSchema,
    label: "Verify Email",
  },
  {
    urlPattern: "/verify-email",
    routerPath: "/(auth)/verify-email",
    auth: "public",
    paramsSchema: tokenSchema,
    label: "Verify Email (legacy alias)",
  },
  {
    urlPattern: "/auth/callback",
    routerPath: "/(auth)/login",
    auth: "public",
    label: "OAuth Callback",
  },
  {
    urlPattern: "/login",
    routerPath: "/(auth)/login",
    auth: "public",
    label: "Login",
  },
  {
    urlPattern: "/signup",
    routerPath: "/(auth)/signup",
    auth: "public",
    label: "Sign Up",
  },
  {
    urlPattern: "/forgot-password",
    routerPath: "/(auth)/forgot-password",
    auth: "public",
    label: "Forgot Password",
  },

  // ── Profile routes ─────────────────────────────────────────────────
  {
    urlPattern: "/u/:username",
    routerPath: "/(protected)/profile/:username",
    auth: "auth-required",
    paramsSchema: usernameSchema,
    label: "User Profile",
  },
  {
    urlPattern: "/profile/:username",
    routerPath: "/(protected)/profile/:username",
    auth: "auth-required",
    paramsSchema: usernameSchema,
    label: "User Profile (alias)",
  },

  // ── Post routes ────────────────────────────────────────────────────
  {
    urlPattern: "/p/:id",
    routerPath: "/(protected)/post/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Post Detail",
  },
  {
    urlPattern: "/post/:id",
    routerPath: "/(protected)/post/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Post Detail (alias)",
  },

  // ── Comments ───────────────────────────────────────────────────────
  {
    urlPattern: "/comments/:postId",
    routerPath: "/(protected)/comments/:postId",
    auth: "auth-required",
    paramsSchema: postIdSchema,
    label: "Post Comments",
  },
  {
    urlPattern: "/comments/replies/:commentId",
    routerPath: "/(protected)/comments/replies/:commentId",
    auth: "auth-required",
    paramsSchema: commentIdSchema,
    label: "Comment Replies",
  },

  // ── Events ─────────────────────────────────────────────────────────
  {
    urlPattern: "/e/:id",
    routerPath: "/(protected)/events/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Event Detail",
  },
  {
    urlPattern: "/events/create",
    routerPath: "/(protected)/events/create",
    auth: "auth-required",
    label: "Create Event",
  },
  {
    urlPattern: "/events/:id",
    routerPath: "/(protected)/events/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Event Detail (alias)",
  },
  {
    urlPattern: "/events",
    routerPath: "/(protected)/(tabs)/events",
    auth: "auth-required",
    label: "Events Tab",
  },

  // ── Stories ────────────────────────────────────────────────────────
  {
    urlPattern: "/story/:id",
    routerPath: "/(protected)/story/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Story Viewer",
  },

  // ── Messages ───────────────────────────────────────────────────────
  {
    urlPattern: "/messages",
    routerPath: "/(protected)/messages",
    auth: "auth-required",
    label: "Messages",
  },
  {
    urlPattern: "/chat/:id",
    routerPath: "/(protected)/chat/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Chat Thread",
  },

  // ── Tickets ────────────────────────────────────────────────────────
  {
    urlPattern: "/ticket/:id",
    routerPath: "/(protected)/ticket/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Ticket",
  },
  {
    urlPattern: "/tickets/success",
    routerPath: "/(protected)/events/my-tickets",
    auth: "auth-required",
    label: "Ticket Purchase Success",
  },
  {
    urlPattern: "/tickets/guest/:token",
    routerPath: "/(public)/tickets/guest/:token",
    auth: "public",
    paramsSchema: tokenSchema,
    label: "Guest Ticket (email magic link)",
  },
  {
    urlPattern: "/tickets/cancel",
    routerPath: "/(protected)/(tabs)/events",
    auth: "auth-required",
    label: "Ticket Purchase Cancelled",
  },
  {
    urlPattern: "/my-tickets",
    routerPath: "/(protected)/events/my-tickets",
    auth: "auth-required",
    label: "My Tickets",
  },

  // ── Organizer ───────────────────────────────────────────────────────
  {
    urlPattern: "/events/:id/organizer",
    routerPath: "/(protected)/events/:id/organizer",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Organizer Dashboard",
  },
  {
    urlPattern: "/events/:id/scanner",
    routerPath: "/(protected)/events/:id/scanner",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Ticket Scanner",
  },
  {
    urlPattern: "/organizer-setup",
    routerPath: "/(protected)/events/organizer-setup",
    auth: "auth-required",
    label: "Organizer Setup",
  },

  // ── Private Room Stripe Return ─────────────────────────────────────
  {
    urlPattern: "/sneaky/success",
    routerPath: "/(protected)/sneaky-lynk",
    auth: "auth-required",
    label: `${getLynkDisplayName()} Access Success`,
  },
  {
    urlPattern: "/sneaky/cancel",
    routerPath: "/(protected)/sneaky-lynk",
    auth: "auth-required",
    label: `${getLynkDisplayName()} Access Cancelled`,
  },

  // ── Video / Calls ──────────────────────────────────────────────────
  {
    urlPattern: "/call/:roomId",
    routerPath: "/(protected)/call/:roomId",
    auth: "auth-required",
    paramsSchema: roomIdSchema,
    label: "Video Call",
  },
  {
    urlPattern: "/room/:id",
    routerPath: "/(video)/room/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Video Room",
  },
  {
    urlPattern: "/rooms",
    routerPath: "/(video)/rooms",
    auth: "auth-required",
    label: getLynkDisplayName(),
  },

  // ── Lynk Private Rooms ────────────────────────────────────────────
  {
    urlPattern: "/sneaky-lynk/room/:id",
    routerPath: "/(protected)/sneaky-lynk/room/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: getLynkDisplayName(),
  },
  {
    urlPattern: "/sl/:id",
    routerPath: "/(protected)/sneaky-lynk/room/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: `${getLynkDisplayName()} (short link)`,
  },
  {
    urlPattern: "/sneaky/:id",
    routerPath: "/(protected)/sneaky-lynk/room/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: `${getLynkDisplayName()} (alias)`,
  },

  // ── DM / Direct Message ────────────────────────────────────────────
  {
    urlPattern: "/dm/:userId",
    routerPath: "/(protected)/messages",
    auth: "auth-required",
    paramsSchema: z.object({ userId: z.string().min(1) }),
    label: "DM by User ID",
  },

  // ── User by ID (fallback when no username) ─────────────────────────
  {
    urlPattern: "/user/:userId",
    routerPath: "/(protected)/profile/:userId",
    auth: "auth-required",
    paramsSchema: z.object({ userId: z.string().min(1) }),
    label: "User Profile by ID",
  },

  // ── Settings ───────────────────────────────────────────────────────
  {
    urlPattern: "/settings",
    routerPath: "/settings",
    auth: "auth-required",
    label: "Settings",
  },
  {
    urlPattern: "/settings/account",
    routerPath: "/settings/account",
    auth: "auth-required",
    label: "Account Settings",
  },
  {
    urlPattern: "/settings/notifications",
    routerPath: "/settings/notifications",
    auth: "auth-required",
    label: "Notification Settings",
  },
  {
    urlPattern: "/settings/privacy",
    routerPath: "/settings/privacy",
    auth: "auth-required",
    label: "Privacy Settings",
  },
  {
    urlPattern: "/settings/blocked",
    routerPath: "/settings/blocked",
    auth: "auth-required",
    label: "Blocked Accounts",
  },
  {
    urlPattern: "/settings/close-friends",
    routerPath: "/settings/close-friends",
    auth: "auth-required",
    label: "Close Friends Settings",
  },
  {
    urlPattern: "/settings/theme",
    routerPath: "/settings/theme",
    auth: "auth-required",
    label: "Theme Settings",
  },
  {
    urlPattern: "/settings/language",
    routerPath: "/settings/language",
    auth: "auth-required",
    label: "Language Settings",
  },

  // ── Recap / Moments ─────────────────────────────────────────────────
  {
    urlPattern: "/recap/week",
    routerPath: "/(protected)/(tabs)/events",
    auth: "auth-required",
    label: "Weekly Recap",
  },
  {
    urlPattern: "/moment/:id",
    routerPath: "/(protected)/post/:id",
    auth: "auth-required",
    paramsSchema: idSchema,
    label: "Moment Detail",
  },

  // ── Tabs / Home ────────────────────────────────────────────────────
  {
    urlPattern: "/home",
    routerPath: "/(protected)/(tabs)",
    auth: "auth-required",
    label: "Home Feed",
  },
  {
    urlPattern: "/search",
    routerPath: "/(protected)/search",
    auth: "auth-required",
    label: "Search",
  },
  {
    urlPattern: "/activity",
    routerPath: "/(protected)/(tabs)/activity",
    auth: "auth-required",
    label: "Activity",
  },
  {
    urlPattern: "/create",
    routerPath: "/(protected)/(tabs)/create",
    auth: "auth-required",
    label: "Create Post",
  },
  {
    urlPattern: "/close-friends",
    routerPath: "/(protected)/close-friends",
    auth: "auth-required",
    label: "Manage Close Friends",
  },
];

/**
 * Match a URL path against the route registry.
 * Returns the matched route entry and extracted params, or null.
 */
export function matchRoute(
  path: string,
): { entry: RouteEntry; params: Record<string, string> } | null {
  const normalizedPath = normalizePath(path);

  for (const entry of ROUTE_REGISTRY) {
    const params = matchPattern(entry.urlPattern, normalizedPath);
    if (params !== null) {
      // Validate params if schema exists
      if (entry.paramsSchema) {
        const result = entry.paramsSchema.safeParse(params);
        if (!result.success) continue; // Skip if params don't validate
      }
      return { entry, params };
    }
  }

  return null;
}

/**
 * Normalize a URL path: lowercase, strip trailing slash, strip leading double slashes.
 */
function normalizePath(path: string): string {
  let p = path.trim();
  // Remove trailing slash (but keep root /)
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Match a pattern like /u/:username against a path like /u/mikevocalz.
 * Returns extracted params or null if no match.
 */
function matchPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const pathPart = pathParts[i];

    if (pp.startsWith(":")) {
      // Dynamic segment
      params[pp.slice(1)] = pathPart;
    } else if (pp.toLowerCase() !== pathPart.toLowerCase()) {
      return null;
    }
  }

  return params;
}

/**
 * Build the Expo Router path with params substituted.
 */
export function buildRouterPath(
  routerPath: string,
  params: Record<string, string>,
): string {
  let result = routerPath;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value);
  }
  return result;
}
