import unittest
from ticket_embed_sandbox_helpers import sandbox_buyer_email


class SandboxBuyerTests(unittest.TestCase):
    def test_ci_runs_and_retries_have_distinct_buyers_in_the_same_mailbox(self):
        self.assertEqual(sandbox_buyer_email('fixture+old@gmail.com', '123', '2'), 'fixture+dvnt-123-2@gmail.com')
        self.assertNotEqual(sandbox_buyer_email('fixture@gmail.com', '123', '1'), sandbox_buyer_email('fixture@gmail.com', '123', '2'))
        self.assertNotEqual(sandbox_buyer_email('fixture@gmail.com', '123'), sandbox_buyer_email('fixture@gmail.com', '124'))

    def test_resend_test_mailbox_supports_labels(self):
        self.assertEqual(sandbox_buyer_email('delivered@resend.dev', '123'), 'delivered+dvnt-123-1@resend.dev')

    def test_unknown_domains_and_local_runs_preserve_the_configured_recipient(self):
        self.assertEqual(sandbox_buyer_email('fixture@example.com', '123'), 'fixture@example.com')
        self.assertEqual(sandbox_buyer_email('fixture+local@gmail.com'), 'fixture+local@gmail.com')

    def test_rejects_malformed_or_overlong_ci_aliases(self):
        for address, run in [('fixture@gmail.com', 'bad@id'), ('x' * 64 + '@gmail.com', '123')]:
            with self.assertRaises(ValueError):
                sandbox_buyer_email(address, run)


if __name__ == '__main__':
    unittest.main()
