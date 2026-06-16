import type { ComponentProps } from 'react';
import { SolitoImage } from 'solito/image';

// Web Image — Solito Image, which renders next/image under the hood (the
// ImageProvider in apps/web/src/app/layout.tsx wires the Next loader). Same
// public API as the native split (packages/ui/src/Image.native.tsx). next/image
// needs explicit width+height OR `fill` inside a positioned parent.
type SolitoImageProps = ComponentProps<typeof SolitoImage>;

export interface ImageProps extends SolitoImageProps {
  className?: string;
  /**
   * Preload this image and opt it out of lazy-loading (next/image `priority`).
   * Use for above-the-fold / LCP images — the first row of the feed, a
   * post-detail hero, an event cover. Don't set it everywhere: `priority`
   * disables lazy-loading, so over-using it regresses performance.
   */
  priority?: boolean;
}

export function Image({ unoptimized, priority, ...props }: ImageProps) {
  const src = typeof props.src === 'string' ? props.src : undefined;

  return (
    <SolitoImage
      priority={priority}
      unoptimized={unoptimized ?? src?.startsWith('blob:') ?? src?.startsWith('data:')}
      {...props}
    />
  );
}
