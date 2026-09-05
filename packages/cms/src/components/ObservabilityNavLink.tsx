/** @jsxImportSource react */
// Nav link to the /admin/observability view (admin.components.afterNavLinks).
import React from 'react'

export default function ObservabilityNavLink() {
  return (
    <a href="/admin/observability" className="dvnt-back" aria-label="Observability">
      <span className="dvnt-back__icon" aria-hidden>
        ▲
      </span>
      <span className="dvnt-back__label">Observability</span>
    </a>
  )
}
