/** @jsxImportSource react */
'use client'
// Edit-view field for the Tickets `qr` UI field: renders a scannable QR from the
// ticket's qrToken (the same token the app/Watch encode, ECC-H). Read-only — the
// token is synced from the live app. Generated client-side so no token ever
// leaves the browser.
import React from 'react'
// toString({type:'svg'}) is pure JS (no canvas / node Buffer / zlib), so it
// bundles + runs cleanly in the browser client component.
import QRCode from 'qrcode'

export default function TicketQRField(props: any) {
  const token: string | undefined = props?.data?.qrToken ?? props?.rowData?.qrToken
  const [svg, setSvg] = React.useState<string>('')

  React.useEffect(() => {
    if (!token) return
    QRCode.toString(String(token), { type: 'svg', errorCorrectionLevel: 'H', margin: 1, width: 220 })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [token])

  if (!token) {
    return <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>No QR token yet (synced from the app).</div>
  }
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Ticket QR</span>
      {svg ? (
        <div
          style={{ width: 220, height: 220, background: '#fff', borderRadius: 12, padding: 10 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Generating…</span>
      )}
    </div>
  )
}
