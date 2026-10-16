"""Pure helpers for the disposable sandbox buyer; never log its address."""
import re

# Resend's delivery simulator accepts labels, without using a personal inbox:
# https://resend.com/docs/dashboard/emails/send-test-emails
SANDBOX_DELIVERY_SINK = 'delivered@resend.dev'


def sandbox_buyer_email(address, run_id='', run_attempt='1'):
    address = address.strip().lower()
    # Fail closed even for local runs and stale CI secrets. A Stripe test key
    # prevents live charges, but does not stop transactional email delivery.
    if not re.fullmatch(r'delivered(?:\+[a-z0-9_-]+)?@resend\.dev', address):
        raise ValueError('Sandbox buyer must use the Resend delivered test sink; personal inboxes are not permitted')
    if not run_id:
        return address
    if not re.fullmatch(r'[0-9]+', run_id) or not re.fullmatch(r'[0-9]+', run_attempt):
        raise ValueError('Invalid CI run identity')
    # Keep retries and PRs separate within the provider's simulated recipient.
    tagged = 'delivered+dvnt-' + run_id + '-' + run_attempt
    if len(tagged) > 64:
        raise ValueError('Sandbox buyer alias exceeds the email local-part limit')
    return tagged + '@resend.dev'
