import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { toPng } from 'html-to-image';

export interface MaskedViewProps {
  maskElement: ReactElement;
  androidRenderingMode?: 'software' | 'hardware';
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testID?: string;
}

/**
 * Web MaskedView — the browser-native equivalent of
 * `@react-native-masked-view/masked-view`.
 *
 * `maskElement` is rendered off-screen, rasterized to a PNG data URL with
 * html-to-image, and applied to the content via CSS `mask-image`. The mask's
 * alpha channel controls visibility — opaque pixels show content, transparent
 * pixels hide it — matching the native MaskedView contract exactly.
 */
export function MaskedView({
  children,
  className,
  maskElement,
  style,
  testID,
}: MaskedViewProps) {
  const maskRef = useRef<HTMLDivElement>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    const node = maskRef.current;
    if (!node) return;

    let cancelled = false;
    // Wait a frame so fonts/layout settle before rasterizing
    const raf = requestAnimationFrame(() => {
      toPng(node, { cacheBust: false, pixelRatio: 2 })
        .then((dataUrl) => {
          if (!cancelled) setMaskUrl(dataUrl);
        })
        .catch(() => {
          /* mask render failed — show content unmasked */
        });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [maskElement]);

  const maskStyles: CSSProperties = maskUrl
    ? {
        WebkitMaskImage: `url(${maskUrl})`,
        maskImage: `url(${maskUrl})`,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }
    : {};

  return (
    <div
      className={className}
      data-testid={testID}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
    >
      {/* Off-screen mask render target — offset lives on the OUTER wrapper so
          the rasterized inner node has no positioning that would shift the
          clone off-canvas in html-to-image */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: -100000,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <div ref={maskRef} style={{ width: '100%', height: '100%' }}>
          {maskElement}
        </div>
      </div>

      {/* Content with the rasterized alpha mask applied */}
      <div style={{ width: '100%', height: '100%', ...maskStyles }}>
        {children}
      </div>
    </div>
  );
}
