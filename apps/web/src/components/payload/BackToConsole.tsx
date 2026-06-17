/** @jsxImportSource react */
// A nav link back to the branded moderation console (admin.components.afterNavLinks).
// Styled as a liquid-glass pill in payload-overrides.css (.dvnt-back).
import React from 'react'

export default function BackToConsole() {
  return (
    <a href="/" className="dvnt-back" aria-label="Back to DVNT Console">
      <span className="dvnt-back__icon" aria-hidden>
        ←
      </span>
      <span className="dvnt-back__label">DVNT Console</span>
    </a>
  )
}
