# Event checkout cutover coverage

The permanent event cutover fence applies to the four supported new-model adapters and denies these unsupported event-payment paths after cutover:

- door-sell: web and Terminal/card-present PaymentIntent creation. This is a destination-charge rail with possible promoter attribution.
- ticket-embed: quote, new checkout, and resume, including an unattached attempt that could create another hosted session. Existing status/cancellation recovery is retained; a paused resume never returns a new payable capability.
- ticket-upgrade: an ordinary platform PaymentIntent for a ticket price difference, not a destination charge and not a durable new-model settlement source. It remains explicitly unsupported after event cutover rather than falsely claiming its proceeds are ledger funded. The guard precedes customer/ephemeral-key and payment creation.

Never-cutover events retain these existing paths. Malformed, missing, stale-schema or unavailable routing results fail closed. The shared deny-only helper never chooses a new rail or mutates a payment.

Inventory of tracked direct provider creates also found membership, promotion, sneaky billing and sneaky access checkout. Those are platform subscriptions/advertising/access rather than event-ticket entitlement; they are outside the event-ticket cohort route. Canceled-attempt replacement remains a separate follow-up; these routing guards do not enable it.

This fence is not a replacement for a cutover drain: quiesce every affected event-payment entrypoint, reconcile/cancel outstanding legacy sessions through authorized operational work, drain admitted requests, then change cohort policy. A route read cannot revoke a payment secret already issued or stop a request that passed the check before policy committed. No drain controller, live cancellation or cutover is performed by this code change.

Synthetic tests execute actual door/upgrade handlers and the embedded handler, including all refusal modes, zero provider/stock/order writes on denial, resume after lost provider response and preserved never-cutover behavior. Dedicated provider sandbox validation remains a rollout gate.
