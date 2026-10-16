"""Conservative purchase gate; cheap contract/browser tests still run for all PRs."""
from pathlib import PurePosixPath
import subprocess
import sys


def needs_sandbox_purchase(path):
    path = path.replace('\\', '/')
    # Reviewed feed-only presentation leaves. Do not add shared EventFlyer or
    # checkout-capable event screens here: those remain purchase-sensitive.
    feed_only = {
        'packages/app/components/event/FeedEventCard.web.tsx',
        'packages/app/components/event/feed-event-card-shape.ts',
        'packages/app/components/event/feed-event-card-shape.test.ts',
        'packages/app/components/feed/feed-event-card.tsx',
        'packages/app/features/home/screen.web.tsx',
        'packages/app/features/home/screen.native.tsx',
        'apps/web/src/app/(frontend)/feed/page.tsx',
        'packages/app/features/navigation/drawer-destinations.ts',
        'packages/app/features/navigation/drawer-destinations.test.ts',
    }
    if path in feed_only:
        return False
    # Database, edge functions and shared client dependencies can affect inventory,
    # authorization, fulfillment or email even without a checkout-like filename.
    prefixes = (
        'apps/mobile/supabase/', 'supabase/',
        'apps/web/public/embed/', 'apps/web/src/app/embed/',
        'apps/web/src/app/tickets/', 'apps/web/src/app/(frontend)/api/',
        'apps/web/src/app/(frontend)/checkout/',
        'apps/web/src/app/(frontend)/public/tickets/',
        'apps/web/src/app/(frontend)/feed/checkout/',
        'apps/web/src/app/(frontend)/feed/events/',
        'apps/web/src/lib/', 'apps/web/src/providers/',
        'packages/app/lib/', 'packages/app/provider/', 'packages/app/providers/',
        'packages/app/features/events/', 'packages/app/features/ticket/',
        'packages/app/features/checkout/', 'packages/app/features/auth/',
        'packages/app/features/routes/screens/(public)/tickets/',
        'packages/app/features/routes/screens/(protected)/checkout/',
        'packages/app/features/routes/screens/(protected)/events/',
        'packages/ui/', 'packages/config/', 'docs/ticketing/',
    )
    if path.startswith(prefixes):
        return True
    parts = PurePosixPath(path).parts
    name = parts[-1] if parts else ''
    # Shared components/styles, routing/build middleware and dependency changes
    # are deliberately conservative, including newly added files in these areas.
    if path.startswith(('packages/app/components/', 'apps/web/src/components/')):
        return True
    if name.endswith(('.css', '.scss')) or name in {
        'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json',
        'vercel.json', '.npmrc', 'middleware.ts', 'proxy.ts', 'layout.tsx',
        'next.config.js', 'next.config.mjs', 'next.config.ts', 'tsconfig.json',
    }:
        return True
    if path.startswith('scripts/') and ('ticket-embed' in name or 'ticket_embed' in name):
        return True
    if path == '.github/workflows/ticket-embed-commerce.yml':
        return True
    # Catch commerce screens/components placed outside the established folders.
    if any(term in path.lower() for term in (
        'checkout', 'payment', 'stripe', 'ticket', 'inventory', 'refund', 'cart',
        'pricing', 'promo', 'order', 'receipt',
    )):
        return True
    # Unknown application code is fail-closed. New commerce directories or
    # runtime helpers must not silently fall outside a hand-maintained list.
    return path.startswith(('apps/web/', 'packages/app/', 'packages/'))


def changed_paths(base, head):
    # No rename detection: moves out of a sensitive path retain their deleted
    # source path. NUL separation handles whitespace and newline filenames.
    output = subprocess.check_output([
        'git', 'diff', '--name-only', '--no-renames', '-z', base + '...' + head,
    ])
    return [path.decode('utf-8') for path in output.split(b'\0') if path]


if __name__ == '__main__':
    # Errors fail the scope job; they never turn an unknown diff into a skip.
    if len(sys.argv) != 3:
        raise SystemExit('Expected base and head commit SHAs')
    paths = changed_paths(sys.argv[1], sys.argv[2])
    print('true' if not paths or any(map(needs_sandbox_purchase, paths)) else 'false')
