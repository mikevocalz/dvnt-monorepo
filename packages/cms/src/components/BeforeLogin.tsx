/** @jsxImportSource react */
import React from 'react'

// Payload still exposes a local break-glass login, but everyday editors should
// use the DVNT Better Auth account they already use in the app.
export default function BeforeLogin() {
  return (
    <div style={{ marginBottom: 20 }}>
      <p
        style={{
          margin: '0 0 18px',
          color: '#3FDCFF',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        Content · Moderation · CMS
      </p>
      <a
        href="/auth/login?returnTo=%2Fadmin%2Fcollections%2Fposts"
        style={{
          display: 'block',
          borderRadius: 8,
          padding: '12px 16px',
          background: '#3FDCFF',
          color: '#02030A',
          fontWeight: 700,
          textAlign: 'center',
          textDecoration: 'none',
        }}
      >
        Continue with your DVNT account
      </a>
      <p style={{ color: '#B3B3C4', fontSize: 13, margin: '10px 0 0' }}>
        Admins and moderators use their regular DVNT app sign-in. The form below
        is only for emergency legacy CMS accounts.
      </p>
    </div>
  )
}
