import type { ComponentProps, ComponentType } from 'react';
import { SolitoImage } from 'solito/image';
import { styled } from 'nativewind';

// @ts-ignore — SolitoImage's generic props produce a union type too complex for TS to represent
const NativeWindSolitoImage = styled(SolitoImage, {
  className: { target: 'style' },
}) as ComponentType<ComponentProps<typeof SolitoImage> & { className?: string }>;

type SolitoImageProps = ComponentProps<typeof NativeWindSolitoImage>;

export interface ImageProps extends SolitoImageProps {
  className?: string;
}

export function Image({ unoptimized, ...props }: ImageProps) {
  const src = typeof props.src === 'string' ? props.src : undefined;

  return (
    <NativeWindSolitoImage
      unoptimized={unoptimized ?? src?.startsWith('blob:') ?? src?.startsWith('data:')}
      {...props}
    />
  );
}
