# Organizer count contract

These metrics are intentionally not interchangeable:

- **Issued tickets:** every ticket row, including free/comp and refunded/cancelled history. A ticket unit is not an order or a unique account.
- **Checked in:** a recorded scan (`scanned` status or a check-in timestamp). Management preserves historical scans even if a ticket is later refunded or cancelled.
- **Awaiting check-in:** active or transfer-pending tickets without a recorded scan. This is not unsold inventory; terminal tickets are excluded. Transfer-pending tickets still need their transfer resolved before use.
- **Valid tickets:** active, scanned and transfer-pending ticket units, including free/comp units. Host summary check-ins/rate use this valid-ticket set.
- **Going:** valid ticket units plus going RSVPs belonging to accounts without a valid ticket. Multiple ticket units held by one account remain multiple seats, not one person.
- **Paid tickets:** valid ticket units with a positive purchase amount. Free/comp tickets remain in Going.
- **RSVP people:** explicit going RSVP records; this column can overlap ticket holders and must not be added directly to Paid tickets.
- **Capacity:** the event's configured capacity. **Tier inventory remaining** is the sum of tier inventory remaining. Those ceilings need not match.
- **Ticket + add-on value:** the existing host calculation of valid-ticket purchase amounts plus retained add-on value, before fees; not a payout figure. Analytics financial gross/net/fees still come from the existing financial ledger. This change does not rewrite either calculation or repair financial data.
- **Issued this month:** the existing monthly issuance count (excluding abandoned rows), including refunded/cancelled history.

## Completeness and freshness

Management follows the roster endpoint's stable cursor beyond the per-page200 limit. Aggregate handlers follow unique-ID cursors beyond PostgREST's configured response cap, including a server cap smaller than requested. All pages must succeed: errors and non-progressing cursors never become zero/partial totals. Exports retain chronological issue order after fetching all rows.

A keyset scan is not a transaction snapshot. Screens opened at different times can legitimately differ as tickets are issued, refunded, cancelled or scanned; this patch does not claim simultaneous cross-screen snapshots.

## Release scope

Deploy the web changes and `get-host-dashboard` and `event-analytics`, including `_shared/read-all-rows.ts`. No database migration, credential change, reissuance, transfer, resend, payment, refund or financial-cache repair is needed or authorized by this patch. Native code has parity changes but requires its normal native release path.

Regression fixtures contain synthetic data only, cover more than1000 rows, partial page failures, duplicate/cursor boundaries, multi-ticket owners, comps, refunds, cancellation and check-in status/timestamps.
