#!/usr/bin/env python3
"""Unit tests use explicit stubs; not a provider acceptance test."""
import importlib.util
import unittest
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location("key_check", Path(__file__).with_name("check-ticket-embed-test-key.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class TestKeyCheck(unittest.TestCase):
    key = "sk_test_" + "a" * 32

    def test_missing_and_live_keys_make_no_request(self):
        for value in ("", " ", "sk_live_" + "b" * 32, "pk_test_" + "c" * 32, "sk_test_YOUR_SECRET_KEY"):
            with self.subTest(value=value[:8]):
                def forbidden(_):
                    self.fail("must reject before contacting Stripe")
                result, error = m.check_key(value, forbidden)
                self.assertIsNotNone(error)
                self.assertFalse(result["authenticated"])

    def test_wrong_key_categories_never_expose_values(self):
        cases = {
            "STRIPE_TEST_SECRET_KEY=" + self.key: "environment_assignment_in_secret_value",
            "\"" + self.key + "\"": "quotes_in_secret_value",
            "pk_test_" + "b" * 32: "publishable_key_in_secret_field",
            "sk_live_" + "b" * 32: "live_key_in_test_field",
            "whsec_" + "b" * 32: "webhook_secret_in_api_key_field",
            self.key[:15] + "\n" + self.key[15:]: "internal_whitespace_in_secret_value",
        }
        for key, expected in cases.items():
            with self.subTest(category=expected):
                called = []
                result, error = m.check_key(key, lambda _: called.append(True))
                self.assertEqual(error, expected)
                self.assertEqual(called, [])
                self.assertNotIn(key, str(result) + str(error))

    def test_accepts_authenticated_test_balance(self):
        result, error = m.check_key("\n" + self.key + "\n", lambda key: {"object":"balance", "livemode":False})
        self.assertIsNone(error)
        self.assertTrue(result["test_mode_confirmed"])

    def test_wrong_response_fails_closed(self):
        for response in (None, {}, [], {"object":"balance"}, {"object":"balance", "livemode":True}, {"object":"balance", "livemode":0}):
            with self.subTest(response=response):
                result, error = m.check_key(self.key, lambda _: response)
                self.assertIsNotNone(error)
                self.assertFalse(result["test_mode_confirmed"])

    def test_provider_errors_are_redacted(self):
        for status in (301, 401, 403, 429, 500):
            with self.subTest(status=status):
                def rejected(_):
                    raise urllib.error.HTTPError("https://api.stripe.com/v1/balance", status, self.key, None, None)
                result, error = m.check_key(self.key, rejected)
                self.assertIsNotNone(error)
                self.assertNotIn(self.key, str(result) + str(error))

    def test_network_errors_are_redacted(self):
        def rejected(_):
            raise RuntimeError(self.key)
        result, error = m.check_key(self.key, rejected)
        self.assertEqual(error, "stripe_connection_failed")
        self.assertNotIn(self.key, str(result) + str(error))

    def test_redirects_rejected(self):
        self.assertIsNone(m.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid"))


if __name__ == "__main__":
    unittest.main()
