// src/app/index.tsx — the DVNT moderation dashboard at `/`.
// Payload's own CMS admin lives at `/admin`; this is the branded react-native-web
// console (AdminApp) that consumes the same Payload REST API.
//
// The dashboard is CLIENT-ONLY: react-native-web's StyleSheet + @expo/html-elements
// don't evaluate in the TanStack Start SSR/RSC server runtime. We lazy-import
// AdminApp and gate it behind a mount effect so the module only loads in the
// browser — the server renders nothing for `/` and never touches react-native-web.
import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'

const AdminApp = lazy(() => import('../dashboard/AdminApp').then((m) => ({ default: m.AdminApp })))

export const Route = createFileRoute('/')({
  component: DashboardRoute,
  head: () => ({ meta: [{ title: 'DVNT · Admin' }] }),
})

function DashboardRoute() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <AdminApp />
    </Suspense>
  )
}
