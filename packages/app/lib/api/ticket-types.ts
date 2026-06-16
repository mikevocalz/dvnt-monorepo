/**
 * Ticket Types API
 *
 * CRUD for ticket types (organizer creates these per event).
 * Used in event create/edit flow and organizer dashboard.
 */

import { supabase } from "../supabase/client";

export type TicketTypeCategory = "admission" | "product" | "service";

export const TICKET_TYPE_CATEGORIES: Array<{
  value: TicketTypeCategory;
  label: string;
  hint: string;
}> = [
  {
    value: "admission",
    label: "Admission",
    hint: "Entry to the event — GA, VIP, table service, etc.",
  },
  {
    value: "product",
    label: "Add-on",
    hint: "Physical items sold alongside entry — drink tokens, merch.",
  },
  {
    value: "service",
    label: "Service",
    hint: "Experiences sold alongside entry — coat check, bottle service.",
  },
];

export interface TicketTypeRecord {
  id: string;
  event_id: number;
  name: string;
  category: TicketTypeCategory;
  description: string | null;
  price_cents: number;
  currency: string;
  quantity_total: number;
  quantity_sold: number;
  max_per_user: number;
  sale_start: string | null;
  sale_end: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateTicketTypeParams {
  eventId: string;
  name: string;
  category?: TicketTypeCategory;
  description?: string;
  priceCents: number;
  currency?: string;
  quantityTotal: number;
  maxPerUser?: number;
  saleStart?: string;
  saleEnd?: string;
}

export const ticketTypesApi = {
  /**
   * Create a ticket type for an event
   */
  async create(
    params: CreateTicketTypeParams,
  ): Promise<TicketTypeRecord | null> {
    try {
      const { data, error } = await supabase
        .from("ticket_types")
        .insert({
          event_id: parseInt(params.eventId),
          name: params.name,
          category: params.category || "admission",
          description: params.description || null,
          price_cents: params.priceCents,
          currency: params.currency || "usd",
          quantity_total: params.quantityTotal,
          max_per_user: params.maxPerUser || 4,
          sale_start: params.saleStart || null,
          sale_end: params.saleEnd || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error("[TicketTypes] create error:", err);
      return null;
    }
  },

  /**
   * Get all ticket types for an event
   */
  async getByEvent(eventId: string): Promise<TicketTypeRecord[]> {
    try {
      const { data, error } = await supabase
        .from("ticket_types")
        .select("*")
        .eq("event_id", parseInt(eventId))
        .order("price_cents", { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("[TicketTypes] getByEvent error:", err);
      return [];
    }
  },

  /**
   * Update a ticket type
   */
  async update(
    id: string,
    updates: Partial<
      Pick<
        TicketTypeRecord,
        | "name"
        | "category"
        | "description"
        | "price_cents"
        | "quantity_total"
        | "max_per_user"
        | "is_active"
        | "sale_start"
      >
    >,
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("ticket_types")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[TicketTypes] update error:", err);
      return false;
    }
  },

  /**
   * Deactivate a ticket type (soft delete)
   */
  async deactivate(id: string): Promise<boolean> {
    return ticketTypesApi.update(id, { is_active: false });
  },

  /**
   * Create default "General Admission" ticket type for an event
   * Called automatically when organizer enables ticketing.
   */
  async createDefault(
    eventId: string,
    priceCents: number,
    quantity: number,
  ): Promise<TicketTypeRecord | null> {
    return ticketTypesApi.create({
      eventId,
      name: priceCents === 0 ? "Free" : "General Admission",
      category: "admission",
      priceCents,
      quantityTotal: quantity,
      maxPerUser: 4,
    });
  },
};
