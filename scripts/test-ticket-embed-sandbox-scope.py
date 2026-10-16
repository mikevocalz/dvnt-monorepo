import subprocess
import unittest
import tempfile
import os
from unittest.mock import patch
from ticket_embed_sandbox_scope import changed_paths, needs_sandbox_purchase


class PurchaseScopeTests(unittest.TestCase):
    def test_commerce_and_shared_dependencies_require_purchase(self):
        for path in [
            'apps/mobile/supabase/functions/_shared/send-resend-email.ts',
            'apps/mobile/supabase/migrations/20261016_inventory.sql',
            'apps/web/src/app/embed/upstream.ts',
            'apps/web/public/embed/widget-client.js',
            'apps/web/src/app/(frontend)/public/tickets/guest/[token]/page.tsx',
            'apps/web/src/app/(frontend)/feed/events/[id]/page.tsx',
            'packages/app/features/events/create.web.tsx',
            'packages/app/lib/api/events.ts',
            'packages/app/features/routes/screens/(protected)/checkout/review.tsx',
            'packages/app/components/button.tsx', 'packages/ui/src/Button.tsx',
            'packages/app/components/event/EventFlyer.tsx',
            'packages/app/features/cart/index.tsx',
            'packages/app/features/payments/screen.web.tsx',
            'packages/app/features/tickets/screen.web.tsx',
            'packages/app/features/routes/screens/(protected)/tickets/[id].tsx',
            'apps/web/src/app/(frontend)/feed/cart/page.tsx',
            'apps/web/src/app/(frontend)/public/events/[slug]/page.tsx',
            'packages/app/features/new-feature/screen.tsx',
            'packages/app/features/routes/screens/(protected)/(tabs)/_layout.tsx',
            'apps/web/src/app/layout.tsx', 'apps/web/src/app/global.css',
            'apps/web/middleware.ts', 'apps/web/next.config.ts',
            'pnpm-lock.yaml', 'packages/app/package.json',
            'scripts/ticket_embed_sandbox_scope.py',
            '.github/workflows/ticket-embed-commerce.yml',
        ]:
            with self.subTest(path=path):
                self.assertTrue(needs_sandbox_purchase(path))

    def test_unrelated_navigation_feed_and_flyer_tests_do_not_purchase(self):
        for path in [
            'packages/app/features/navigation/drawer-destinations.ts',
            'packages/app/features/home/screen.web.tsx',
            'packages/app/features/home/screen.native.tsx',
            'packages/app/components/event/FeedEventCard.web.tsx',
            'packages/app/components/event/feed-event-card-shape.ts',
            'packages/app/components/event/feed-event-card-shape.test.ts',
            'packages/app/components/feed/feed-event-card.tsx',
            'apps/web/src/app/(frontend)/feed/page.tsx',
            'scripts/test-feed-flyer-render.cjs', 'scripts/test-event-flyer.cjs',
            '.github/workflows/event-flyer.yml', 'README.md',
        ]:
            with self.subTest(path=path):
                self.assertFalse(needs_sandbox_purchase(path))

    def test_diff_preserves_deleted_source_and_whitespace_paths(self):
        with patch('subprocess.check_output', return_value=b'old checkout.ts\0new\nname.ts\0') as command:
            self.assertEqual(changed_paths('base', 'head'), ['old checkout.ts', 'new\nname.ts'])
        self.assertEqual(command.call_args.args[0], ['git', 'diff', '--name-only', '--no-renames', '-z', 'base...head'])

    def test_real_git_move_out_of_commerce_still_requires_purchase(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args]).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Scope Test')
            git('config', 'user.email', 'scope@example.invalid')
            from pathlib import Path
            source = Path(directory) / 'packages/app/lib/tickets/example.ts'
            source.parent.mkdir(parents=True)
            source.write_text('fixture\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            source.rename(Path(directory) / 'unrelated.ts')
            git('add', '-A')
            git('commit', '-qm', 'move')
            head = git('rev-parse', 'HEAD')
            old_cwd = os.getcwd()
            try:
                os.chdir(directory)
                paths = changed_paths(base, head)
            finally:
                os.chdir(old_cwd)
            self.assertIn('packages/app/lib/tickets/example.ts', paths)
            self.assertTrue(any(map(needs_sandbox_purchase, paths)))

    def test_diff_failure_cannot_silently_skip(self):
        with patch('subprocess.check_output', side_effect=subprocess.CalledProcessError(1, 'git')):
            with self.assertRaises(subprocess.CalledProcessError):
                changed_paths('base', 'head')


if __name__ == '__main__':
    unittest.main()
