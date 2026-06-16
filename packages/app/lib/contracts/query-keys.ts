import { qk } from "@dvnt/app/lib/query/keys";

export const queryKeys = qk;

export const cartQueryKeys = {
  detail: qk.cart.detail,
  lineItems: qk.cart.lineItems,
  status: qk.cart.status,
};

export const ticketQueryKeys = {
  mine: qk.tickets.mine,
  forEvent: qk.tickets.forEvent,
  byEventAndCategory: qk.tickets.byEventAndCategory,
};
