#!/usr/bin/env python3
"""Read-only Stripe TEST key authentication; never a purchase acceptance test.

Only sanitized booleans are printed. Raw keys, balances, emails and API response
bodies must never appear in logs or artifacts. No redirects or Stripe writes.
"""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_key(raw_key, read_balance):
    key = raw_key.strip()
    result = {"present": bool(key), "test_format": False,
              "authenticated": False, "test_mode_confirmed": False}
    if not key:
        return result, "missing_test_key"
    # Report only a category, never the value or any part of its secret suffix.
    if "=" in key and (key.startswith("STRIPE_") or key.startswith("export ")):
        return result, "environment_assignment_in_secret_value"
    if key[:1] in ("\"", "'") or key[-1:] in ("\"", "'"):
        return result, "quotes_in_secret_value"
    if key.startswith(("pk_test_", "pk_live_")):
        return result, "publishable_key_in_secret_field"
    if key.startswith(("sk_live_", "rk_live_")):
        return result, "live_key_in_test_field"
    if key.startswith("whsec_"):
        return result, "webhook_secret_in_api_key_field"
    if any(character.isspace() for character in key):
        return result, "internal_whitespace_in_secret_value"
    if not re.fullmatch(r"(?:sk|rk)_test_[A-Za-z0-9]{16,}", key):
        return result, "invalid_test_key_format"
    if any(word in key.lower() for word in ("your_key", "placeholder", "replace_me", "example")):
        return result, "placeholder_test_key"
    result["test_format"] = True
    try:
        response = read_balance(key)
    except urllib.error.HTTPError as error:
        return result, ("stripe_authentication_rejected" if error.code == 401 else
                        "stripe_permission_denied" if error.code == 403 else
                        "stripe_redirect_rejected" if 300 <= error.code < 400 else
                        "stripe_http_error")
    except Exception:
        return result, "stripe_connection_failed"
    if not isinstance(response, dict) or response.get("object") != "balance":
        return result, "unexpected_stripe_response"
    result["authenticated"] = True
    if response.get("livemode") is not False:
        return result, "stripe_test_mode_not_confirmed"
    result["test_mode_confirmed"] = True
    return result, None


def read_balance(key):
    request = urllib.request.Request(
        "https://api.stripe.com/v1/balance", method="GET",
        headers={"Authorization": "Bearer " + key})
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=20) as response:
        return json.load(response)


def main():
    checked, error = check_key(os.environ.get("STRIPE_TEST_SECRET_KEY", ""), read_balance)
    inputs = ("STRIPE_TEST_PUBLISHABLE_KEY", "TICKET_EMBED_SANDBOX_HOST_URL",
              "TICKET_EMBED_SANDBOX_ID", "TICKET_EMBED_SANDBOX_EMAIL")
    report = {"check": "read_only_stripe_test_key_authentication",
              "purchase_test_performed": False, "production_changed": False,
              "stripe": checked, "error": error,
              "configured": {name: bool(os.environ.get(name, "").strip()) for name in inputs}}
    Path("stripe-test-key-check.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if error:
        print("BLOCKED: " + error + ". No payment or live request was attempted.")
        return 1
    print("PASS: Stripe authenticated the TEST key and returned livemode=false. "
          "This is NOT payment, ticket delivery, or production release acceptance.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
