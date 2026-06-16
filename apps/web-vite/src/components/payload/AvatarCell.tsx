'use client'
// Custom list-cell that renders a member's avatar as a rounded square (DVNT
// avatars are never circular). Falls back to initials. Wired on the Members
// `avatarUrl` field via admin.components.Cell.
import React from 'react'

const box: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  objectFit: 'cover',
  flexShrink: 0,
  background: '#2a2440',
}

export default function AvatarCell(props: any) {
  const url: string | undefined = props?.cellData || props?.rowData?.avatarUrl
  const name: string = props?.rowData?.username || props?.rowData?.name || '?'
  if (url) return <img src={url} alt="" loading="lazy" style={box} />
  return (
    <span style={{ ...box, display: 'inline-grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
      {String(name).slice(0, 2).toUpperCase()}
    </span>
  )
}
