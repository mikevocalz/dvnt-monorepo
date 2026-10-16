import unittest
from pathlib import Path
from ticket_embed_sandbox_helpers import SANDBOX_DELIVERY_SINK, sandbox_buyer_email


class SandboxBuyerTests(unittest.TestCase):
    def test_ci_runs_and_retries_have_distinct_sink_buyers(self):
        self.assertEqual(sandbox_buyer_email(SANDBOX_DELIVERY_SINK, '123', '2'), 'delivered+dvnt-123-2@resend.dev')
        self.assertNotEqual(sandbox_buyer_email(SANDBOX_DELIVERY_SINK, '123', '1'), sandbox_buyer_email(SANDBOX_DELIVERY_SINK, '123', '2'))
        self.assertNotEqual(sandbox_buyer_email(SANDBOX_DELIVERY_SINK, '123'), sandbox_buyer_email(SANDBOX_DELIVERY_SINK, '124'))

    def test_sink_labels_and_local_runs(self):
        self.assertEqual(sandbox_buyer_email('delivered+old@resend.dev', '123'), 'delivered+dvnt-123-1@resend.dev')
        self.assertEqual(sandbox_buyer_email(' Delivered+local@RESEND.DEV '), 'delivered+local@resend.dev')
        self.assertEqual(sandbox_buyer_email(SANDBOX_DELIVERY_SINK), SANDBOX_DELIVERY_SINK)

    def test_rejects_real_inboxes_and_non_delivery_sinks_in_ci_and_locally(self):
        for address in ['fixture@gmail.com', 'fixture+dvnt-123@gmail.com',
                        'fixture@outlook.com', 'fixture@example.com',
                        'bounced@resend.dev', 'complained@resend.dev',
                        'suppressed@resend.dev', 'other@resend.dev',
                        'delivered@resend.dev.example.com', 'delivered@sub.resend.dev',
                        'delivered@resend.dev,fixture@gmail.com',
                        'delivered+\nfixture@resend.dev', '', 'invalid']:
            for run in ['', '123']:
                with self.subTest(address=address, run=run), self.assertRaises(ValueError):
                    sandbox_buyer_email(address, run)

    def test_rejects_malformed_or_overlong_ci_identity(self):
        for run, attempt in [('bad@id', '1'), ('123', 'bad'), ('1' * 64, '1')]:
            with self.assertRaises(ValueError):
                sandbox_buyer_email(SANDBOX_DELIVERY_SINK, run, attempt)

    def test_ci_uses_literal_sink_not_legacy_personal_secret(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / '.github/workflows/ticket-embed-commerce.yml').read_text()
        self.assertIn('TICKET_EMBED_SANDBOX_EMAIL: ' + SANDBOX_DELIVERY_SINK, workflow)
        self.assertNotIn('secrets.TICKET_EMBED_SANDBOX_EMAIL', workflow)


if __name__ == '__main__':
    unittest.main()
