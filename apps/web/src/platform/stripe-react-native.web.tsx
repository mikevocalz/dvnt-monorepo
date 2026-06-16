'use client';

import React, { createContext, useContext, useMemo, useRef } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

type InitStripeParams = {
  publishableKey: string;
};

type PaymentSheetParams = {
  paymentIntentClientSecret?: string;
  setupIntentClientSecret?: string;
  returnURL?: string;
};

type StripeContextValue = {
  getStripe: () => Promise<Stripe | null>;
};

const StripeContext = createContext<StripeContextValue>({
  getStripe: async () => null,
});

let stripePromise: Promise<Stripe | null> | null = null;
let paymentSheetParams: PaymentSheetParams | null = null;

export async function initStripe({ publishableKey }: InitStripeParams) {
  stripePromise = publishableKey ? loadStripe(publishableKey) : null;
}

export function StripeProvider({
  children,
  publishableKey,
}: React.PropsWithChildren<InitStripeParams>) {
  const localPromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : Promise.resolve(null)),
    [publishableKey],
  );
  const latestPromiseRef = useRef(localPromise);
  latestPromiseRef.current = localPromise;

  const value = useMemo<StripeContextValue>(
    () => ({
      getStripe: () => stripePromise ?? latestPromiseRef.current,
    }),
    [],
  );

  return (
    <StripeContext.Provider value={value}>
      <Elements stripe={localPromise}>{children}</Elements>
    </StripeContext.Provider>
  );
}

export function useStripe() {
  const { getStripe } = useContext(StripeContext);

  return {
    initPaymentSheet: async (params: PaymentSheetParams) => {
      paymentSheetParams = params;
      await getStripe();
      return {};
    },
    presentPaymentSheet: async () => {
      const clientSecret =
        paymentSheetParams?.paymentIntentClientSecret ??
        paymentSheetParams?.setupIntentClientSecret;

      if (!clientSecret) {
        return { error: { message: 'Missing Stripe client secret' } };
      }

      const reviewUrl = new URL('/feed/checkout/review', window.location.origin);
      reviewUrl.searchParams.set('clientSecret', clientSecret);
      if (paymentSheetParams?.returnURL) {
        reviewUrl.searchParams.set('returnURL', paymentSheetParams.returnURL);
      }
      window.location.assign(reviewUrl.toString());
      return {};
    },
    confirmPaymentSheetPayment: async () => ({}),
  };
}

export function CardField() {
  return null;
}

export function useConfirmPayment() {
  return { confirmPayment: async () => ({}) };
}
