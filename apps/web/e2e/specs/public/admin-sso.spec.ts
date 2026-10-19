import { expect, test } from '@playwright/test';

// No real passwords, session tokens or production accounts. These tests prove
// the public entrance sends staff to the app's normal login and preserves the
// deep link; Payload still performs the actual role/session checks.
test('signed-out editor requests use the DVNT login and keep the editor destination', async ({ request, baseURL }) => {
  const res = await request.get('/admin/collections/posts', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const destination = new URL(res.headers()['location'], baseURL);
  expect(destination.pathname).toBe('/auth/login');
  expect(destination.searchParams.get('returnTo')).toBe('/admin/collections/posts');
});

test('signed-out CMS login goes to the regular app account instead of asking for a second password', async ({ request, baseURL }) => {
  const res = await request.get('/admin/login', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const destination = new URL(res.headers()['location'], baseURL);
  expect(destination.pathname).toBe('/auth/login');
  expect(destination.searchParams.get('returnTo')).toBe('/admin/collections/posts');
});

test('blog-host admin URL redirects to the canonical app host, not a blog article', async ({ request, baseURL }) => {
  const origin = new URL(baseURL || 'http://localhost:3000');
  const localBlogHost = `blog.localhost:${origin.port || '3000'}`;
  const res = await request.get(new URL('/admin/collections/posts', origin).toString(), {
    headers: { host: localBlogHost },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  const target = new URL(res.headers()['location']);
  expect(target.hostname).toBe('localhost');
  expect(target.pathname).toBe('/admin/collections/posts');
});

test('explicit local recovery login remains reachable for an emergency CMS account', async ({ request }) => {
  const res = await request.get('/admin/login?local=1', { maxRedirects: 0 });
  // The request must reach Payload (which may challenge or render) rather than
  // the app's automatic /auth/login redirect.
  const location = res.headers()['location'] || '';
  expect(location).not.toContain('/auth/login?returnTo=');
});
