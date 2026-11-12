/** Pure routing contract for the future separate-charge checkout adapter.
 * Not activated by any production checkout endpoint. An environment flag alone
 * is insufficient: persisted order enrollment and rollout approval are required.
 */
export type ChargeModel = 'destination_charge' | 'separate_charges_and_transfers';
export interface SeparateChargeGate {
  enabled: boolean;
  rolloutApproved: boolean;
  durableOrderId: string | null;
  allocationSnapshotPersisted: boolean;
  refundDisputeInterlockReady: boolean;
  sourceReconciliationReady: boolean;
}

export function chooseChargeModel(
  gate: SeparateChargeGate,
  persistedModel?: ChargeModel | null,
  hasExistingPayment = false,
): ChargeModel {
  if (persistedModel != null && persistedModel !== 'destination_charge' &&
      persistedModel !== 'separate_charges_and_transfers') throw new Error('Unknown persisted charge model');
  // A retry follows its immutable saved model, not today's feature flag.
  // Unknown historical payments must be reconciled, never guessed into SCT.
  if (hasExistingPayment && !persistedModel) throw new Error('Existing payment model requires reconciliation');
  if (persistedModel === 'destination_charge') return persistedModel;
  const wantsSeparate = persistedModel === 'separate_charges_and_transfers' || gate.enabled;
  if (!wantsSeparate) return 'destination_charge';
  if (!gate.enabled || !gate.rolloutApproved || !gate.durableOrderId ||
      !gate.allocationSnapshotPersisted || !gate.refundDisputeInterlockReady ||
      !gate.sourceReconciliationReady) {
    throw new Error('Separate-charge rollout is blocked');
  }
  return 'separate_charges_and_transfers';
}

/** Returns only the financial routing fields. Never combine with pre-existing
 * destination/application fee fields. Checkout callers must persist model first.
 */
export function chargeRoutingFields(
  model: ChargeModel,
  destination: string,
  applicationFeeCents: number,
  hostedSession = false,
): Record<string, string> {
  if (!Number.isSafeInteger(applicationFeeCents) || applicationFeeCents < 0) {
    throw new Error('Invalid application fee');
  }
  if (model !== 'destination_charge' && model !== 'separate_charges_and_transfers') {
    throw new Error('Unknown charge model');
  }
  const metadataKey = hostedSession
    ? 'payment_intent_data[metadata][charge_model]' : 'metadata[charge_model]';
  const fields: Record<string,string> = { [metadataKey]: model };
  if (hostedSession) fields['metadata[charge_model]'] = model;
  if (model === 'separate_charges_and_transfers') return fields;
  if (!destination.startsWith('acct_')) throw new Error('Missing destination');
  if (hostedSession) {
    fields['payment_intent_data[transfer_data][destination]'] = destination;
    fields['payment_intent_data[application_fee_amount]'] = String(applicationFeeCents);
  } else {
    fields['transfer_data[destination]'] = destination;
    fields.application_fee_amount = String(applicationFeeCents);
  }
  return fields;
}
