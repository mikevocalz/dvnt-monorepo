import type { ComponentProps } from 'react';
import { SolitoImage } from 'solito/image';

type SolitoImageProps = ComponentProps<typeof SolitoImage>;

export interface ImageProps extends SolitoImageProps {
  className?: string;
}

export function Image({ unoptimized, ...props }: ImageProps) {
  const src = typeof props.src === 'string' ? props.src : undefined;

  return (
    <SolitoImage
      unoptimized={unoptimized ?? src?.startsWith('blob:') ?? src?.startsWith('data:')}
      {...props}
    />
  );
}
