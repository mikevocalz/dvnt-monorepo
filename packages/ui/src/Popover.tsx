import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, View } from 'react-native';

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
      <View style={{ position: 'relative' }}>{children}</View>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger({ children }: PopoverTriggerProps) {
  const { open, setOpen } = usePopover();

  return <Pressable onPress={() => setOpen(!open)}>{children}</Pressable>;
}

function PopoverContent({ children, className }: PopoverContentProps) {
  const { open, setOpen } = usePopover();

  if (!open) {
    return null;
  }

  const close = () => setOpen(false);
  const content = typeof children === 'function' ? children({ close }) : children;

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
      <Pressable
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
        }}
        onPress={close}
      >
        <Pressable
          className={className}
          style={{
            width: '100%',
            maxWidth: 360,
            padding: 16,
            borderRadius: 12,
            backgroundColor: '#ffffff',
          }}
          onPress={(event) => event.stopPropagation()}
        >
          {content}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const Popover = Object.assign(PopoverRoot, {
  Content: PopoverContent,
  Trigger: PopoverTrigger,
});
