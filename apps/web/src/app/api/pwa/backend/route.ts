import { getPublicWebBackend } from '@/lib/public-web-backend';

export const dynamic = 'force-dynamic';

/** The service worker is a static file, so obtain its public config locally. */
export function GET() {
  try {
    return Response.json(getPublicWebBackend(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Public web backend configuration is unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
