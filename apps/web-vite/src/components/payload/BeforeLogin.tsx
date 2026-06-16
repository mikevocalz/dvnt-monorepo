// Kicker above the Payload login form (admin.components.beforeLogin).
import React from 'react'

export default function BeforeLogin() {
  return (
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
  )
}
