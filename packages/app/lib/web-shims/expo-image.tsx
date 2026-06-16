import React from 'react'

type ContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'

interface ImageProps {
  source?: { uri?: string } | string | number | null
  src?: string
  style?: React.CSSProperties & { width?: number | string; height?: number | string }
  contentFit?: ContentFit
  transition?: number
  cachePolicy?: string
  recyclingKey?: string
  alt?: string
  className?: string
  [key: string]: any
}

export function Image({ source, src, style, contentFit = 'cover', alt = '', className, ...rest }: ImageProps) {
  const uri =
    src ||
    (typeof source === 'string' ? source : typeof source === 'object' && source !== null ? (source as any).uri : null)

  if (!uri) {
    return <div style={{ width: style?.width, height: style?.height, backgroundColor: '#1a1a1a', ...(style as any) }} className={className} />
  }

  return (
    <img
      src={uri}
      alt={alt}
      className={className}
      style={{
        objectFit: contentFit as React.CSSProperties['objectFit'],
        display: 'block',
        ...(style as React.CSSProperties),
      }}
      {...rest}
    />
  )
}

export function prefetch(_url: string) {}
export function clearMemoryCache() {}
export function clearDiskCache() {}
export const ImageBackground = Image

export default Image
