/**
 * Event Waitlist API
 *
 * Backed by supabase/functions/event-waitlist. Idempotent join/leave +
 * a status check used by the event detail screen to render the right
 * CTA when a tier is sold out.
 */

import { invokeEdge } from "./invoke-edge";

export interface WaitlistStatus {
  joined: boolean;
  id: string | null;
  createdAt: string | null;
}

interface BaseArgs {
  eventId: string | number;
  ticketTypeId?: string | null;
}

interface WaitlistResponse {
  ok?: boolean;
  joined?: boolean;
  id?: string | null;
  createdAt?: string | null;
  error?: string;
}

async function call(
  action: string,
  args: BaseArgs,
): Promise<WaitlistResponse> {
  const { data, error } = await invokeEdge<WaitlistResponse>("event-waitlist", {
    event_id: args.eventId,
    ticket_type_id: args.ticketTypeId ?? null,
    action,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok !== true) {
    throw new Error(data?.error || "Waitlist request failed");
  }
  return data;
}

export const eventWaitlistApi = {
  async getStatus(args: BaseArgs): Promise<WaitlistStatus> {
    try {
      const r = await call("status", args);
      return {
        joined: !!r.joined,
        id: r.id ?? null,
        createdAt: r.createdAt ?? null,
      };
    } catch (err) {
      console.error("[Waitlist] getStatus error:", err);
      return { joined: false, id: null, createdAt: null };
    }
  },

  async join(args: BaseArgs): Promise<WaitlistStatus> {
    const r = await call("join", args);
    return {
      joined: true,
      id: r.id ?? null,
      createdAt: r.createdAt ?? null,
    };
  },

  async leave(args: BaseArgs): Promise<void> {
    await call("leave", args);
  },
};
