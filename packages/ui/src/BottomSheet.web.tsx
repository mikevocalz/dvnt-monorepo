import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

// ── Shared types (mirror the subset of @gorhom/bottom-sheet used on web) ──────

export interface BottomSheetProps {
  /** Initial snap point index. -1 = closed. */
  index?: number;
  /** Snap points — numbers (px) or percentage strings e.g. "50%". */
  snapPoints?: Array<string | number>;
  /** Whether the sheet is detached (floating, inset from bottom). Default true on web. */
  detached?: boolean;
  /** Horizontal margin when detached (px). Default 16. */
  marginHorizontal?: number;
  /** Bottom inset when detached (px). Default 24. */
  bottomInset?: number;
  /** Border radius. Default 16. */
  borderRadius?: number;
  /** Backdrop opacity (0–1). Default 0.5. */
  backdropOpacity?: number;
  /** Close on backdrop press. Default true. */
  enablePanDownToClose?: boolean;
  /** Background color of the sheet. Default '#1c1c1e'. */
  backgroundColor?: string;
  /** Called when the sheet index changes (index=-1 means closed). */
  onChange?: (index: number) => void;
  /** Called when the sheet closes. */
  onClose?: () => void;
  /** Backdrop renderer — receives `onPress` for close behaviour. */
  backdropComponent?: (props: BottomSheetBackdropProps) => ReactNode;
  /** Background renderer. */
  backgroundComponent?: (props: BottomSheetBackgroundProps) => ReactNode;
  /** Handle renderer. */
  handleComponent?: (() => ReactNode) | null;
  /** Handle indicator style. */
  handleIndicatorStyle?: CSSProperties;
  /** Background style passthrough. */
  backgroundStyle?: CSSProperties;
  /** Container style passthrough. */
  style?: CSSProperties;
  children?: ReactNode;
}

export interface BottomSheetBackdropProps {
  style?: CSSProperties;
  onPress?: () => void;
  appearsOnIndex?: number;
  disappearsOnIndex?: number;
  opacity?: number;
  pressBehavior?: 'close' | 'none';
}

export interface BottomSheetBackgroundProps {
  style?: CSSProperties;
}

export interface BottomSheetHandleProps {
  style?: CSSProperties;
  indicatorStyle?: CSSProperties;
}

export interface BottomSheetFooterProps {
  animatedFooterPosition?: number;
}

export interface BottomSheetMethods {
  snapToIndex: (index: number) => void;
  snapToPosition: (position: string | number) => void;
  expand: () => void;
  collapse: () => void;
  close: () => void;
  forceClose: () => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

export function BottomSheetView({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={{ flex: 1, ...style }}>{children}</div>;
}

export function BottomSheetScrollView({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as CSSProperties['WebkitOverflowScrolling'], ...style }}>
      {children}
    </div>
  );
}

export function BottomSheetFlatList<T>({
  data,
  renderItem,
  keyExtractor,
  style,
}: {
  data: T[];
  renderItem: (info: { item: T; index: number }) => ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', ...style }}>
      {data.map((item, index) => (
        <div key={keyExtractor ? keyExtractor(item, index) : String(index)}>
          {renderItem({ item, index })}
        </div>
      ))}
    </div>
  );
}

export function BottomSheetSectionList<T>({
  sections,
  renderItem,
  renderSectionHeader,
  keyExtractor,
  style,
}: {
  sections: Array<{ title: string; data: T[] }>;
  renderItem: (info: { item: T; index: number }) => ReactNode;
  renderSectionHeader?: (info: { section: { title: string } }) => ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', ...style }}>
      {sections.map((section) => (
        <div key={section.title}>
          {renderSectionHeader?.({ section })}
          {section.data.map((item, index) => (
            <div key={keyExtractor ? keyExtractor(item, index) : `${section.title}-${index}`}>
              {renderItem({ item, index })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BottomSheetBackdrop({
  style,
  onPress,
  opacity = 0.5,
  pressBehavior = 'close',
}: BottomSheetBackdropProps) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: `rgba(0,0,0,${opacity})`,
        zIndex: 0,
        ...style,
      }}
      onClick={pressBehavior === 'close' ? onPress : undefined}
    />
  );
}

export function BottomSheetHandle({
  style,
  indicatorStyle,
}: BottomSheetHandleProps) {
  return (
    <div
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 10,
        paddingBottom: 6,
        display: 'flex',
        ...style,
      }}
    >
      <div
        style={{
          width: 40,
          height: 5,
          borderRadius: 3,
          backgroundColor: 'rgba(120,120,128,0.6)',
          ...indicatorStyle,
        }}
      />
    </div>
  );
}

export function BottomSheetFooter({
  children,
}: {
  children?: ReactNode;
  animatedFooterPosition?: number;
}) {
  return <div style={{ width: '100%' }}>{children}</div>;
}

export function BottomSheetTextInput({
  style,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { style?: CSSProperties }) {
  return <input style={{ width: '100%', boxSizing: 'border-box', ...style }} {...props} />;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveSnapPoint(
  point: string | number,
  containerHeight: number,
): number {
  if (typeof point === 'number') return point;
  const match = point.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) return Math.round(containerHeight * (parseFloat(match[1]) / 100));
  return 300;
}

// ── Main BottomSheet ───────────────────────────────────────────────────────────

function BottomSheetComponent(
  {
    index = 0,
    snapPoints = ['50%'],
    detached = true,
    marginHorizontal = 16,
    bottomInset = 24,
    borderRadius = 16,
    backdropOpacity = 0.5,
    backgroundColor = '#1c1c1e',
    enablePanDownToClose = false,
    onChange,
    onClose,
    backdropComponent,
    backgroundComponent,
    handleComponent,
    handleIndicatorStyle,
    backgroundStyle,
    style,
    children,
  }: BottomSheetProps,
  ref: React.Ref<BottomSheetMethods>,
) {
  const [currentIndex, setCurrentIndex] = useState(index);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  );

  useEffect(() => {
    function update() {
      setContainerHeight(window.innerHeight);
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const resolvedSnaps = snapPoints.map((p) =>
    resolveSnapPoint(p, containerHeight),
  );

  const snapTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(-1, Math.min(idx, resolvedSnaps.length - 1));
      setCurrentIndex(clamped);
      onChange?.(clamped);
      if (clamped === -1) onClose?.();
    },
    [resolvedSnaps.length, onChange, onClose],
  );

  useImperativeHandle(ref, () => ({
    snapToIndex: (idx) => snapTo(idx),
    snapToPosition: () => {},
    expand: () => snapTo(resolvedSnaps.length - 1),
    collapse: () => snapTo(0),
    close: () => snapTo(-1),
    forceClose: () => snapTo(-1),
  }));

  useEffect(() => {
    setCurrentIndex(index);
  }, [index]);

  const isOpen = currentIndex >= 0;
  const sheetHeight =
    isOpen && resolvedSnaps[currentIndex] != null
      ? resolvedSnaps[currentIndex]
      : 0;

  const outerRadius = detached ? borderRadius : `${borderRadius}px ${borderRadius}px 0 0`;
  const bottom = detached ? bottomInset : 0;
  const left = detached ? marginHorizontal : 0;
  const right = detached ? marginHorizontal : 0;

  const sheetStyle: CSSProperties = {
    position: 'fixed',
    bottom,
    left,
    right,
    height: sheetHeight,
    borderRadius: typeof outerRadius === 'number' ? outerRadius : outerRadius,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1,
    transition: 'height 0.3s cubic-bezier(0.4,0,0.2,1)',
    backgroundColor,
    ...backgroundStyle,
    ...style,
  };

  const backdrop = backdropComponent
    ? backdropComponent({
        opacity: backdropOpacity,
        pressBehavior: enablePanDownToClose ? 'close' : 'none',
        onPress: () => snapTo(-1),
      })
    : isOpen
      ? (
          <BottomSheetBackdrop
            opacity={backdropOpacity}
            pressBehavior={enablePanDownToClose ? 'close' : 'none'}
            onPress={() => snapTo(-1)}
          />
        )
      : null;

  const background = backgroundComponent
    ? backgroundComponent({ style: sheetStyle })
    : null;

  const handle =
    handleComponent === null
      ? null
      : handleComponent
        ? handleComponent()
        : (
            <BottomSheetHandle indicatorStyle={handleIndicatorStyle} />
          );

  if (!isOpen) return null;

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>{backdrop}</div>
      <div style={{ ...sheetStyle, pointerEvents: 'auto' }}>
        {background}
        {handle}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export const BottomSheet = forwardRef(BottomSheetComponent);
export default BottomSheet;
