"""Pure helpers for the disposable sandbox buyer; never log its address."""
import re

# These providers deliver plus-addresses to the original configured mailbox.
PLUS_ADDRESS_DOMAINS = {'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'resend.dev'}


def sandbox_buyer_email(address, run_id='', run_attempt='1'):
    address = address.strip()
    local, separator, domain = address.rpartition('@')
    if not separator or not local or not domain:
        raise ValueError('A valid sandbox buyer email is required')
    if not run_id or domain.lower() not in PLUS_ADDRESS_DOMAINS:
        return address
    if not re.fullmatch(r'[0-9]+', run_id) or not re.fullmatch(r'[0-9]+', run_attempt):
        raise ValueError('Invalid CI run identity')
    # Keep retries and PRs separate without changing the recipient mailbox.
    tagged = local.split('+', 1)[0] + '+dvnt-' + run_id + '-' + run_attempt
    if len(tagged) > 64:
        raise ValueError('Sandbox buyer alias exceeds the email local-part limit')
    return tagged + '@' + domain
