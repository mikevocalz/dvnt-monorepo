/**
 * Payment Types & Data Contracts
 *
 * Central type definitions for ALL payment-related data in DVNT.
 * Every screen, API call, and edge function references these types.
 *
 * Stripe objects mapped: Customer, PaymentMethod, PaymentIntent,
 * SetupIntent, Charge, Refund, Dispute, BalanceTransaction,
 * Invoice/Receipt, Payout, Account/Connect, Transfer
 */

// ─── Status Enums ─────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type RefundStatus =
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled";

export type DisputeStatus =
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "needs_response"
  | "under_review"
  | "charge_refunded"
  | "won"
  | "lost";

export type PayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "canceled" | "on_hold";

export type OrderStatus =
  | "created"
  | "payment_pending"
  | "payment_failed"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "disputed";

export type ConnectAccountStatus =
  | "not_started"
  | "onboarding_incomplete"
  | "restricted"
  | "active";

// ─── Payment Method ───────────────────────────────────────────

export interface PaymentMethod {
  id: string;
  type: "card" | "bank_account" | "apple_pay" | "google_pay";
  isDefault: boolean;
  card?: {
    brand: string; // visa, mastercard, amex, discover
    last4: string;
    expMonth: number;
    expYear: number;
    funding: "credit" | "debit" | "prepaid" | "unknown";
  };
  bankAccount?: {
    bankName: string;
    last4: string;
    accountType: "checking" | "savings";
  };
  createdAt: string;
}

// ─── Order / Purchase ─────────────────────────────────────────

export interface OrderLineItem {
  id: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
  totalAmountCents: number;
}

export interface OrderFees {
  subtotalCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  type: "event_ticket" | "promotion" | "sneaky_access";
  currency: string;
  fees: OrderFees;
  paymentMethodLast4?: string;
  paymentMethodBrand?: string;
  stripePaymentIntentId?: string;
  /** Event reference (for ticket/promo orders) */
  event?: {
    id: string;
    title: string;
    coverImageUrl?: string;
    startDate?: string;
    location?: string;
  };
  /** Ticket references (for ticket orders) */
  tickets?: {
    id: string;
    ticketTypeName: string;
    qrToken: string;
    status: string;
  }[];
  /** Timeline events */
  timeline: OrderTimelineEvent[];
  /** Receipt / invoice availability */
  receiptAvailable: boolean;
  invoiceAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderTimelineEvent {
  type:
    | "created"
    | "payment_authorized"
    | "payment_captured"
    | "receipt_generated"
    | "refund_requested"
    | "refund_processed"
    | "dispute_opened"
    | "dispute_resolved";
  label: string;
  timestamp: string;
  detail?: string;
}

// ─── Receipt / Invoice ────────────────────────────────────────

export type DocumentType = "receipt" | "invoice" | "ticket";
export type PrintMode = "pdf" | "thermal58" | "thermal80";

export interface ReceiptDocument {
  orderId: string;
  type: DocumentType;
  pdfUrl: string;
  expiresAt: string;
  printModes: PrintMode[];
  thermalHtmlUrl?: string;
}

// ─── Refund ───────────────────────────────────────────────────

export interface RefundRequest {
  orderId: string;
  reason: "duplicate" | "fraudulent" | "requested_by_customer" | "other";
  notes?: string;
}

export interface Refund {
  id: string;
  orderId: string;
  status: RefundStatus;
  amountCents: number;
  currency: string;
  reason: string;
  createdAt: string;
  completedAt?: string;
  /** Partial refund? */
  isPartial: boolean;
  originalAmountCents: number;
}

// ─── Dispute ──────────────────────────────────────────────────

export interface Dispute {
  id: string;
  orderId: string;
  status: DisputeStatus;
  amountCents: number;
  currency: string;
  reason: string;
  evidenceDueBy?: string;
  createdAt: string;
  resolvedAt?: string;
  /** What the user can do */
  actionRequired: boolean;
  actionDescription?: string;
}

// ─── Host: Payout ─────────────────────────────────────────────

export interface PayoutSummary {
  availableBalanceCents: number;
  pendingBalanceCents: number;
  nextPayoutEstimate?: string;
  currency: string;
  payoutsEnabled: boolean;
  totalPayoutsCents: number;
  totalEventsPaidOut: number;
}

export interface PayoutRecord {
  id: string;
  eventId: number;
  eventTitle: string;
  status: PayoutStatus;
  grossCents: number;
  netCents: number;
  feeCents: number;
  releaseAt: string;
  arrivalDate?: string;
  bankLast4?: string;
  stripePayoutId?: string;
  createdAt: string;
}

// ─── Host: Transaction (Balance) ──────────────────────────────

export type TransactionType =
  | "charge"
  | "refund"
  | "payout"
  | "fee"
  | "adjustment"
  | "transfer";

export interface BalanceTransaction {
  id: string;
  type: TransactionType;
  description: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  status: string;
  eventId?: number;
  eventTitle?: string;
  createdAt: string;
}

// ─── Host: Connect Account ────────────────────────────────────

export interface ConnectAccount {
  status: ConnectAccountStatus;
  stripeAccountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requiresAction: boolean;
  actionUrl?: string;
  /** Verification requirements */
  pendingVerification?: string[];
  createdAt?: string;
}

// ─── Branding ─────────────────────────────────────────────────

export interface OrganizerBranding {
  hostId: string;
  logoUrl?: string;
  logoMonochromeUrl?: string;
  displayName: string;
  /** Fallback text when no logo (e.g. "Hosted by <name>") */
  fallbackText: string;
  updatedAt: string;
}

export interface BrandingPreview {
  docType: DocumentType;
  mode: PrintMode;
  previewHtml: string;
}

// ─── API Response Wrappers ────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
  total?: number;
}

export interface ApiResult<T> {
  data?: T;
  error?: string;
}

// ─── Payment Status Chip Config ───────────────────────────────

export const PAYMENT_STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pending: { bg: "rgba(234, 179, 8, 0.15)", text: "#EAB308", label: "Pending" },
  requires_action: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "Action Required",
  },
  processing: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    label: "Processing",
  },
  succeeded: {
    bg: "rgba(34, 197, 94, 0.15)",
    text: "#22C55E",
    label: "Paid",
  },
  paid: { bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E", label: "Paid" },
  failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", label: "Failed" },
  canceled: {
    bg: "rgba(107, 114, 128, 0.15)",
    text: "#6B7280",
    label: "Canceled",
  },
  refunded: {
    bg: "rgba(168, 85, 247, 0.15)",
    text: "#A855F7",
    label: "Refunded",
  },
  partially_refunded: {
    bg: "rgba(168, 85, 247, 0.15)",
    text: "#A855F7",
    label: "Partial Refund",
  },
  disputed: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#EF4444",
    label: "Disputed",
  },
  in_transit: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    label: "In Transit",
  },
  on_hold: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "On Hold",
  },
};

// ─── Payout Status Config ─────────────────────────────────────

export const PAYOUT_STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pending: { bg: "rgba(234, 179, 8, 0.15)", text: "#EAB308", label: "Pending" },
  in_transit: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    label: "In Transit",
  },
  paid: { bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E", label: "Paid" },
  failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", label: "Failed" },
  on_hold: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "On Hold",
  },
  canceled: {
    bg: "rgba(107, 114, 128, 0.15)",
    text: "#6B7280",
    label: "Canceled",
  },
};
