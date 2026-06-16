/**
 * Payments Store — Zustand state for all payment screens
 *
 * Replaces useState across payment methods, purchases, receipts,
 * order detail, refunds, disputes, host payouts, and branding screens.
 */

import { create } from "zustand";
import type {
  PaymentMethod,
  Order,
  Refund,
  Dispute,
  PayoutSummary,
  PayoutRecord,
  BalanceTransaction,
  ConnectAccount,
  OrganizerBranding,
  ReceiptDocument,
} from "@dvnt/app/lib/types/payments";

// ─── Attendee Payment Methods ─────────────────────────────────

interface PaymentMethodsSlice {
  methods: PaymentMethod[];
  isLoading: boolean;
  error: string | null;
  setMethods: (methods: PaymentMethod[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  removeMethod: (id: string) => void;
  setDefault: (id: string) => void;
}

// ─── Purchases / Orders ───────────────────────────────────────

interface PurchasesSlice {
  purchases: Order[];
  purchasesLoading: boolean;
  purchasesError: string | null;
  purchasesCursor: string | undefined;
  purchasesHasMore: boolean;
  setPurchases: (purchases: Order[]) => void;
  appendPurchases: (
    purchases: Order[],
    cursor?: string,
    hasMore?: boolean,
  ) => void;
  setPurchasesLoading: (loading: boolean) => void;
  setPurchasesError: (error: string | null) => void;
}

// ─── Order Detail ─────────────────────────────────────────────

interface OrderDetailSlice {
  activeOrder: Order | null;
  orderLoading: boolean;
  orderError: string | null;
  setActiveOrder: (order: Order | null) => void;
  setOrderLoading: (loading: boolean) => void;
  setOrderError: (error: string | null) => void;
}

// ─── Receipts / PDF Viewer ────────────────────────────────────

interface ReceiptSlice {
  activeDocument: ReceiptDocument | null;
  documentLoading: boolean;
  documentError: string | null;
  setActiveDocument: (doc: ReceiptDocument | null) => void;
  setDocumentLoading: (loading: boolean) => void;
  setDocumentError: (error: string | null) => void;
}

// ─── Refunds ──────────────────────────────────────────────────

interface RefundsSlice {
  refunds: Refund[];
  refundsLoading: boolean;
  refundRequestLoading: boolean;
  setRefunds: (refunds: Refund[]) => void;
  setRefundsLoading: (loading: boolean) => void;
  setRefundRequestLoading: (loading: boolean) => void;
}

// ─── Host: Disputes ──────────────────────────────────────────

interface HostDisputesSlice {
  hostDisputes: Dispute[];
  hostDisputesLoading: boolean;
  setHostDisputes: (disputes: Dispute[]) => void;
  setHostDisputesLoading: (loading: boolean) => void;
}

// ─── Host: Payouts ────────────────────────────────────────────

interface HostPayoutsSlice {
  payoutSummary: PayoutSummary | null;
  payouts: PayoutRecord[];
  payoutsLoading: boolean;
  payoutSummaryLoading: boolean;
  setPayoutSummary: (summary: PayoutSummary | null) => void;
  setPayouts: (payouts: PayoutRecord[]) => void;
  setPayoutsLoading: (loading: boolean) => void;
  setPayoutSummaryLoading: (loading: boolean) => void;
}

// ─── Host: Transactions ───────────────────────────────────────

interface HostTransactionsSlice {
  transactions: BalanceTransaction[];
  transactionsLoading: boolean;
  transactionsFilter: string | undefined;
  setTransactions: (txns: BalanceTransaction[]) => void;
  setTransactionsLoading: (loading: boolean) => void;
  setTransactionsFilter: (filter: string | undefined) => void;
}

// ─── Host: Connect ────────────────────────────────────────────

interface ConnectSlice {
  connectAccount: ConnectAccount | null;
  connectLoading: boolean;
  onboardingLoading: boolean;
  setConnectAccount: (account: ConnectAccount | null) => void;
  setConnectLoading: (loading: boolean) => void;
  setOnboardingLoading: (loading: boolean) => void;
}

// ─── Ticket Checkout ──────────────────────────────────────────

interface CheckoutSlice {
  checkoutLoading: boolean;
  setCheckoutLoading: (loading: boolean) => void;
}

// ─── Branding ─────────────────────────────────────────────────

interface BrandingSlice {
  branding: OrganizerBranding | null;
  brandingLoading: boolean;
  brandingSaving: boolean;
  setBranding: (branding: OrganizerBranding | null) => void;
  setBrandingLoading: (loading: boolean) => void;
  setBrandingSaving: (saving: boolean) => void;
}

// ─── Combined Store ───────────────────────────────────────────

type PaymentsState = PaymentMethodsSlice &
  PurchasesSlice &
  OrderDetailSlice &
  ReceiptSlice &
  RefundsSlice &
  HostDisputesSlice &
  HostPayoutsSlice &
  HostTransactionsSlice &
  ConnectSlice &
  BrandingSlice &
  CheckoutSlice & {
    reset: () => void;
  };

export const usePaymentsStore = create<PaymentsState>((set) => ({
  // Payment Methods
  methods: [],
  isLoading: false,
  error: null,
  setMethods: (methods) => set({ methods }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  removeMethod: (id) =>
    set((s) => ({ methods: s.methods.filter((m) => m.id !== id) })),
  setDefault: (id) =>
    set((s) => ({
      methods: s.methods.map((m) => ({ ...m, isDefault: m.id === id })),
    })),

  // Purchases
  purchases: [],
  purchasesLoading: false,
  purchasesError: null,
  purchasesCursor: undefined,
  purchasesHasMore: false,
  setPurchases: (purchases) => set({ purchases }),
  appendPurchases: (purchases, cursor, hasMore) =>
    set((s) => ({
      purchases: [...s.purchases, ...purchases],
      purchasesCursor: cursor,
      purchasesHasMore: hasMore ?? false,
    })),
  setPurchasesLoading: (purchasesLoading) => set({ purchasesLoading }),
  setPurchasesError: (purchasesError) => set({ purchasesError }),

  // Order Detail
  activeOrder: null,
  orderLoading: false,
  orderError: null,
  setActiveOrder: (activeOrder) => set({ activeOrder }),
  setOrderLoading: (orderLoading) => set({ orderLoading }),
  setOrderError: (orderError) => set({ orderError }),

  // Receipts
  activeDocument: null,
  documentLoading: false,
  documentError: null,
  setActiveDocument: (activeDocument) => set({ activeDocument }),
  setDocumentLoading: (documentLoading) => set({ documentLoading }),
  setDocumentError: (documentError) => set({ documentError }),

  // Refunds
  refunds: [],
  refundsLoading: false,
  refundRequestLoading: false,
  setRefunds: (refunds) => set({ refunds }),
  setRefundsLoading: (refundsLoading) => set({ refundsLoading }),
  setRefundRequestLoading: (refundRequestLoading) =>
    set({ refundRequestLoading }),

  // Host Disputes
  hostDisputes: [],
  hostDisputesLoading: false,
  setHostDisputes: (hostDisputes) => set({ hostDisputes }),
  setHostDisputesLoading: (hostDisputesLoading) => set({ hostDisputesLoading }),

  // Host Payouts
  payoutSummary: null,
  payouts: [],
  payoutsLoading: false,
  payoutSummaryLoading: false,
  setPayoutSummary: (payoutSummary) => set({ payoutSummary }),
  setPayouts: (payouts) => set({ payouts }),
  setPayoutsLoading: (payoutsLoading) => set({ payoutsLoading }),
  setPayoutSummaryLoading: (payoutSummaryLoading) =>
    set({ payoutSummaryLoading }),

  // Host Transactions
  transactions: [],
  transactionsLoading: false,
  transactionsFilter: undefined,
  setTransactions: (transactions) => set({ transactions }),
  setTransactionsLoading: (transactionsLoading) => set({ transactionsLoading }),
  setTransactionsFilter: (transactionsFilter) => set({ transactionsFilter }),

  // Connect
  connectAccount: null,
  connectLoading: false,
  onboardingLoading: false,
  setConnectAccount: (connectAccount) => set({ connectAccount }),
  setConnectLoading: (connectLoading) => set({ connectLoading }),
  setOnboardingLoading: (onboardingLoading) => set({ onboardingLoading }),

  // Ticket Checkout
  checkoutLoading: false,
  setCheckoutLoading: (checkoutLoading) => set({ checkoutLoading }),

  // Branding
  branding: null,
  brandingLoading: false,
  brandingSaving: false,
  setBranding: (branding) => set({ branding }),
  setBrandingLoading: (brandingLoading) => set({ brandingLoading }),
  setBrandingSaving: (brandingSaving) => set({ brandingSaving }),

  // Reset all
  reset: () =>
    set({
      methods: [],
      isLoading: false,
      error: null,
      purchases: [],
      purchasesLoading: false,
      purchasesError: null,
      purchasesCursor: undefined,
      purchasesHasMore: false,
      activeOrder: null,
      orderLoading: false,
      orderError: null,
      activeDocument: null,
      documentLoading: false,
      documentError: null,
      refunds: [],
      refundsLoading: false,
      refundRequestLoading: false,
      hostDisputes: [],
      hostDisputesLoading: false,
      payoutSummary: null,
      payouts: [],
      payoutsLoading: false,
      payoutSummaryLoading: false,
      transactions: [],
      transactionsLoading: false,
      transactionsFilter: undefined,
      connectAccount: null,
      connectLoading: false,
      onboardingLoading: false,
      branding: null,
      brandingLoading: false,
      brandingSaving: false,
      checkoutLoading: false,
    }),
}));
