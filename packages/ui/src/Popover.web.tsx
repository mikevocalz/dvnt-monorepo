import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

export type PopoverProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export type PopoverTriggerProps = {
  children: ReactNode;
};

export type PopoverContentProps = {
  align?: 'start' | 'center' | 'end';
  children: ReactNode | ((props: { close: () => void }) => ReactNode);
  className?: string;
  side?: 'top' | 'bottom';
  style?: CSSProperties;
};

export function usePopover() {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error('Popover components must be used within Popover');
  }
  return context;
}

function PopoverRoot({
  children,
  defaultOpen = false,
  onOpenChange,
  open: controlledOpen,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;

  const value = useMemo<PopoverContextValue>(
    () => ({
      open,
      setOpen: (nextOpen) => {
        if (controlledOpen === undefined) {
          setInternalOpen(nextOpen);
        }
        onOpenChange?.(nextOpen);
      },
    }),
    [controlledOpen, onOpenChange, open],
  );

  return (
    <PopoverContext.Provider value={value}>
      <div style={{ display: 'inline-block', position: 'relative' }}>{children}</div>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger({ children }: PopoverTriggerProps) {
  const { open, setOpen } = usePopover();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setOpen(!open)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(!open);
        }
      }}
    >
      {children}
    </div>
  );
}

function getContentPosition(side: PopoverContentProps['side'], align: PopoverContentProps['align']) {
  const style: CSSProperties = {
    position: 'absolute',
    zIndex: 30,
    minWidth: 240,
  };

  if (side === 'top') {
    style.bottom = 'calc(100% + 8px)';
  } else {
    style.top = 'calc(100% + 8px)';
  }

  if (align === 'end') {
    style.right = 0;
  } else if (align === 'center') {
    style.left = '50%';
    style.transform = 'translateX(-50%)';
  } else {
    style.left = 0;
  }

  return style;
}

function PopoverContent({
  align = 'start',
  children,
  className,
  side = 'bottom',
  style,
}: PopoverContentProps) {
  const { open, setOpen } = usePopover();

  if (!open) {
    return null;
  }

  const close = () => setOpen(false);
  const content = typeof children === 'function' ? children({ close }) : children;

  return (
    <>
      <button
        type="button"
        aria-label="Close popover"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 20,
          border: 0,
          background: 'transparent',
          cursor: 'default',
        }}
        onClick={close}
      />
      <div
        className={className}
        role="dialog"
        style={{
          ...getContentPosition(side, align),
          padding: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          backgroundColor: '#ffffff',
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)',
          ...style,
        }}
      >
        {content}
      </div>
    </>
  );
}

export const Popover = Object.assign(PopoverRoot, {
  Content: PopoverContent,
  Trigger: PopoverTrigger,
});
