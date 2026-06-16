/**
 * Payments API — Attendee + Host payment data access
 *
 * All payment data flows through edge functions that wrap Stripe API calls.
 * This module provides the client-side API for all payment screens.
 */

import { supabase } from "../supabase/client";
import { getCurrentUserAuthId } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";
import type {
  PaymentMethod,
  Order,
  OrderFees,
  OrderTimelineEvent,
  ReceiptDocument,
  Refund,
  RefundRequest,
  Dispute,
  PayoutSummary,
  PayoutRecord,
  BalanceTransaction,
  ConnectAccount,
  OrganizerBranding,
  PaginatedResponse,
} from "@/lib/types/payments";

// ─── Attendee: Payment Methods ────────────────────────────────

export const paymentMethodsApi = {
  async list(): Promise<PaymentMethod[]> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "payment-methods",
        {
          body: { action: "list" },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return data?.methods || [];
    } catch (err: any) {
      console.error("[Payments] listPaymentMethods error:", err);
      return [];
    }
  },

  async createSetupIntent(): Promise<{
    clientSecret?: string;
    ephemeralKey?: string;
    customerId?: string;
    error?: string;
  }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "payment-methods",
        {
          body: { action: "setup" },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.error("[Payments] createSetupIntent error:", err);
      return { error: err.message };
    }
  },

  async setDefault(
    methodId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "payment-methods",
        {
          body: { action: "set_default", method_id: methodId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      console.error("[Payments] setDefault error:", err);
      return { success: false, error: err.message };
    }
  },

  async remove(
    methodId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "payment-methods",
        {
          body: { action: "remove", method_id: methodId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      console.error("[Payments] remove error:", err);
      return { success: false, error: err.message };
    }
  },
};

// ─── Attendee: Purchases / Orders ─────────────────────────────

export const purchasesApi = {
  async list(cursor?: string): Promise<PaginatedResponse<Order>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "list", cursor },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listPurchases error:", err);
      return { data: [], hasMore: false };
    }
  },

  async getOrder(orderId: string): Promise<Order | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "detail", order_id: orderId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data?.order || null;
    } catch (err: any) {
      console.error("[Payments] getOrder error:", err);
      return null;
    }
  },

  async getReceipt(orderId: string): Promise<ReceiptDocument | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "receipt", order_id: orderId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || null;
    } catch (err: any) {
      console.error("[Payments] getReceipt error:", err);
      return null;
    }
  },

  async getInvoice(orderId: string): Promise<ReceiptDocument | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "invoice", order_id: orderId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || null;
    } catch (err: any) {
      console.error("[Payments] getInvoice error:", err);
      return null;
    }
  },

  async requestRefund(
    request: RefundRequest,
  ): Promise<{ success: boolean; refundId?: string; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "refund_request", ...request },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { success: false };
    } catch (err: any) {
      console.error("[Payments] requestRefund error:", err);
      return { success: false, error: err.message };
    }
  },
};

// ─── Attendee: Refunds ────────────────────────────────────────

export const refundsApi = {
  async list(cursor?: string): Promise<PaginatedResponse<Refund>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "refunds", cursor },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listRefunds error:", err);
      return { data: [], hasMore: false };
    }
  },
};

// ─── Attendee: Disputes ───────────────────────────────────────

export const disputesApi = {
  async list(cursor?: string): Promise<PaginatedResponse<Dispute>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "disputes", cursor },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listDisputes error:", err);
      return { data: [], hasMore: false };
    }
  },
};

// ─── Host: Payouts ────────────────────────────────────────────

export const hostPayoutsApi = {
  async getSummary(): Promise<PayoutSummary | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("host-payouts", {
        body: { action: "summary" },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || null;
    } catch (err: any) {
      console.error("[Payments] getPayoutSummary error:", err);
      return null;
    }
  },

  async listPayouts(cursor?: string): Promise<PaginatedResponse<PayoutRecord>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("host-payouts", {
        body: { action: "list", cursor },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listPayouts error:", err);
      return { data: [], hasMore: false };
    }
  },

  async getPayoutDetail(payoutId: string): Promise<PayoutRecord | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("host-payouts", {
        body: { action: "detail", payout_id: payoutId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data?.payout || null;
    } catch (err: any) {
      console.error("[Payments] getPayoutDetail error:", err);
      return null;
    }
  },
};

// ─── Host: Transactions ───────────────────────────────────────

export const hostTransactionsApi = {
  async list(
    cursor?: string,
    type?: string,
  ): Promise<PaginatedResponse<BalanceTransaction>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "host-transactions",
        {
          body: { action: "list", cursor, type },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listTransactions error:", err);
      return { data: [], hasMore: false };
    }
  },
};

// ─── Host: Disputes ───────────────────────────────────────────

export const hostDisputesApi = {
  async list(cursor?: string): Promise<PaginatedResponse<Dispute>> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("host-disputes", {
        body: { action: "list", cursor },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || { data: [], hasMore: false };
    } catch (err: any) {
      console.error("[Payments] listHostDisputes error:", err);
      return { data: [], hasMore: false };
    }
  },
};

// ─── Host: Connect Account ────────────────────────────────────

export const connectApi = {
  async getStatus(): Promise<ConnectAccount> {
    try {
      const token = await requireBetterAuthToken();

      const { data, error } = await supabase.functions.invoke(
        "organizer-connect",
        {
          body: { action: "status" },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;

      const connected = data?.connected || false;
      let status: ConnectAccount["status"] = "not_started";
      if (connected && data?.charges_enabled && data?.payouts_enabled) {
        status = "active";
      } else if (connected && data?.details_submitted) {
        status = "restricted";
      } else if (connected) {
        status = "onboarding_incomplete";
      }

      return {
        status,
        chargesEnabled: data?.charges_enabled || false,
        payoutsEnabled: data?.payouts_enabled || false,
        detailsSubmitted: data?.details_submitted || false,
        requiresAction: connected && !data?.details_submitted,
        stripeAccountId: data?.stripe_account_id,
        pendingVerification: data?.pending_verification,
      };
    } catch (err: any) {
      console.error("[Payments] getConnectStatus error:", err);
      return {
        status: "not_started",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requiresAction: false,
      };
    }
  },

  async getOnboardingLink(): Promise<{ url?: string; error?: string }> {
    try {
      const token = await requireBetterAuthToken();

      const { data, error } = await supabase.functions.invoke(
        "organizer-connect",
        {
          body: { action: "start" },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      return { url: data?.url };
    } catch (err: any) {
      console.error("[Payments] getOnboardingLink error:", err);
      return { error: err.message };
    }
  },
};

// ─── Branding ─────────────────────────────────────────────────

export const brandingApi = {
  async get(): Promise<OrganizerBranding | null> {
    try {
      const hostId = await getCurrentUserAuthId();
      if (!hostId) return null;

      const { data, error } = await supabase
        .from("organizer_branding")
        .select("*")
        .eq("host_id", hostId)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      if (!data) return null;

      return {
        hostId: data.host_id,
        logoUrl: data.logo_url,
        logoMonochromeUrl: data.logo_monochrome_url,
        displayName: data.display_name || "",
        fallbackText: data.fallback_text || "",
        updatedAt: data.updated_at,
      };
    } catch (err: any) {
      console.error("[Payments] getBranding error:", err);
      return null;
    }
  },

  async update(
    branding: Partial<OrganizerBranding>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const hostId = await getCurrentUserAuthId();
      if (!hostId) return { success: false, error: "Not authenticated" };

      const { error } = await supabase.from("organizer_branding").upsert({
        host_id: hostId,
        logo_url: branding.logoUrl,
        logo_monochrome_url: branding.logoMonochromeUrl,
        display_name: branding.displayName,
        fallback_text: branding.fallbackText,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      console.error("[Payments] updateBranding error:", err);
      return { success: false, error: err.message };
    }
  },
};

// ─── Receipt / Ticket Print Assets ────────────────────────────

export const printApi = {
  async getTicketPrintAssets(orderId: string): Promise<{
    pdfUrl?: string;
    thermalHtmlUrl?: string;
    printModes: string[];
    expiresAt?: string;
  } | null> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("purchases", {
        body: { action: "ticket_print", order_id: orderId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return data || null;
    } catch (err: any) {
      console.error("[Payments] getTicketPrintAssets error:", err);
      return null;
    }
  },
};
