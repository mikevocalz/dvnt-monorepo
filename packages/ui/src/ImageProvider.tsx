'use client';

import type { ComponentProps, ReactNode } from 'react';
import { SolitoImageProvider } from 'solito/image';

export interface ImageProviderProps
  extends Omit<ComponentProps<typeof SolitoImageProvider>, 'children'> {
  children: ReactNode;
}

export function ImageProvider({ children, ...props }: ImageProviderProps) {
  return <SolitoImageProvider {...props}>{children}</SolitoImageProvider>;
}
