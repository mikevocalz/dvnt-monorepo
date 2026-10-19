/** @jsxImportSource react */
// App-owned wrapper around Payload's generated RootPage. Keep the session gate
// when regenerating Payload routes; middleware cookie presence is only a hint.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { readBetterAuthSession } from '@dvnt/cms/auth/betterAuthSession'
import { resolveAdminEntry, adminPath, isLocalAdminRecovery } from '@dvnt/app/lib/auth/admin-entry'
import { AdminSignOut } from '@/dashboard/AdminSignOut'

import config from '@payload-config'
import { generatePageMetadata, RootPage } from '@payloadcms/next/views'

import { importMap } from '../importMap.js'

type Args = {
  params: Promise<{
    segments: string[]
  }>
  searchParams: Promise<{
    [key: string]: string | string[]
  }>
}

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

const Page = async ({ params, searchParams }: Args) => {
  const path = adminPath((await params).segments)
  const search = await searchParams
  if (path === '/admin/logout') return <AdminSignOut />
  if (!isLocalAdminRecovery(path, search)) {
    const requestHeaders = await headers()
    const payload = await getPayload({ config, importMap })
    // A valid local Payload session is sufficient. For rejected SSO sessions,
    // distinguish expiry/revocation from a still-signed-in nonstaff account.
    const login = await resolveAdminEntry({ path, search }, {
      authenticate: async () => (await payload.auth({ headers: requestHeaders })).user,
      readAppSession: () => readBetterAuthSession(requestHeaders.get('cookie')),
    })
    if (login) redirect(login)
  }
  return RootPage({ config, params, searchParams, importMap })
}

export default Page
