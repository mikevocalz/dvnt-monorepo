# Manual promoter codes in member checkout

## Incident

The member checkout and mixed-cart Review Order only sent the manual code field to the regular promo validator. A valid event_promoters code such as COOLIN was rejected as an invalid promo even though its customer discount and commission policy were active. Fixing the guest checkout did not fix these two separate screens.

## Change

The existing authenticated validate-promo-code endpoint accepts an explicit accept_promoter flag. A normal promo match keeps precedence and all its restrictions; only an absent normal code can resolve as an active, exact, case-insensitive promoter code for this event. The opt-in response identifies code_kind and never masquerades a promoter as a normal promo. Older clients keep their prior response contract. No validation writes a claim, order or payment.

Both member screens use the shared useCheckoutCode hook. It places promoter codes in the existing event-scoped promoter-ref store, clears the regular promo slot, and displays the existing promoter banner. The existing parent handoff and cart API carry this as promoterCode, not promoCode. The existing payment backend continues to revalidate and apply the admission-only discount and record commission. Add-ons remain outside the promoter discount. A separately applied normal promo follows the existing stacking policy.

Invalid, edited, pending or unapplied nonempty codes disable continuation. Late responses cannot replace a code on a new screen/cart or overwrite a newer choice. Saved-claim hydration cannot overwrite a manual ref captured in the meantime.

## Verification boundaries

The handler tests execute the actual authenticated validator and shared helpers with explicitly substituted authentication and database. Browser tests extract the actual member CheckoutSheet and its actual parent handoff, then execute the actual Review Order, shared hook, stores, pricing and cart API. Transport, account authentication, unrelated UI and the payment provider are fixture boundaries. No production member session is invented or borrowed. A passed fixture payment handoff is not an actual card payment, ticket delivery, or physical-iPhone acceptance.

The regression checks cover COOLIN case-insensitively, normal promo compatibility, scoped/expired/capped/paused/removed codes, no fallback on database failure, unapplied-code payment blocking, stale replies, direct review entry, the sheet-to-cart handoff and a $10 coat-check add-on that receives no promoter discount. The sample $30 admission with a 10% promoter discount is $27 plus the existing $1.68 buyer fee; with $10 coat check, the existing two-line fee is $2.93 and the review total is $39.93.

## Rollout

Deploy the existing authenticated validation function before the updated web UI. Preserve verifySession and the deployed gateway verification setting; do not change server secrets, payment flags, database schema or other purchase paths. Publish source and record the actual reviewed commit, function version, web deployment and test results in the PR. The separate embedded-payment sandbox-release gate is unchanged. Roll back web before the validator. Never modify existing purchases to validate this fix.
