import type { Endpoint } from 'payload'
import crypto from 'crypto'

/**
 * POST /api/sentry-webhook — receiver for the dvnt-admin internal
 * integration's issue webhooks (created/regressed/resolved). Lands trimmed
 * issue METADATA in the sentry-alerts collection — never event bodies, never
 * user context (§2.4 hygiene holds even here).
 *
 * Signature: Sentry signs the raw body with the integration's Client Secret
 * (sentry-hook-signature, HMAC-SHA256). Verification is enforced when
 * SENTRY_WEBHOOK_SECRET is set; without it we still only persist the
 * allowlisted metadata fields below.
 */
export const sentryWebhookEndpoint: Endpoint = {
  path: '/sentry-webhook',
  method: 'post',
  handler: async (req) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any
    const raw: string = anyReq.text ? await anyReq.text() : JSON.stringify(anyReq.body ?? {})

    const secret = process.env.SENTRY_WEBHOOK_SECRET
    if (secret) {
      const signature = req.headers.get('sentry-hook-signature') || ''
      const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
      const valid =
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      if (!valid) {
        return Response.json({ ok: false, error: 'bad signature' }, { status: 401 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = {}
    try {
      body = JSON.parse(raw)
    } catch {
      return Response.json({ ok: false, error: 'bad json' }, { status: 400 })
    }

    // Installation pings / non-issue resources: ack and ignore.
    const resource = req.headers.get('sentry-hook-resource') || ''
    const issue = body?.data?.issue
    if (resource !== 'issue' || !issue) {
      return Response.json({ ok: true, ignored: true })
    }

    const action = ['created', 'regressed', 'resolved', 'unresolved'].includes(body?.action)
      ? body.action
      : 'other'

    await req.payload.create({
      collection: 'sentry-alerts',
      overrideAccess: true,
      data: {
        action,
        title: String(issue.title ?? 'Sentry issue').slice(0, 300),
        shortId: issue.shortId ?? null,
        issueId: issue.id != null ? String(issue.id) : null,
        project: issue.project?.slug ?? null,
        level: issue.level ?? null,
        permalink: issue.permalink ?? (issue.id ? `https://5th-galaxy-studios.sentry.io/issues/${issue.id}/` : null),
      },
    })

    return Response.json({ ok: true })
  },
}
