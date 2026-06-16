import { useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  MenuAction,
  MenuComponentProps,
  MenuComponentRef,
  NativeActionEvent,
} from '@expo/ui/community/menu';

export type MenuViewProps = MenuComponentProps & {
  className?: string;
  ref?: React.Ref<MenuComponentRef>;
};

export type { MenuAction, MenuAttributes, MenuComponentRef, MenuState, NativeActionEvent } from '@expo/ui/community/menu';

function flattenActions(actions: MenuAction[]): MenuAction[] {
  return actions.flatMap((action) => {
    if (action.attributes?.hidden) {
      return [];
    }

    return [action, ...(action.subactions ? flattenActions(action.subactions) : [])];
  });
}

export function MenuView({
  actions,
  children,
  className,
  onPressAction,
  ref,
  shouldOpenOnLongPress,
  style,
  testID,
}: MenuViewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const visibleActions = useMemo(() => flattenActions(actions), [actions]);

  useImperativeHandle(ref, () => ({
    show: () => setIsOpen(true),
  }));

  function fireAction(action: MenuAction) {
    if (action.attributes?.disabled) {
      return;
    }

    const event: NativeActionEvent = {
      nativeEvent: {
        event: action.id ?? action.title,
      },
    };

    onPressAction?.(event);
    setIsOpen(false);
  }

  return (
    <div
      className={className}
      data-testid={testID}
      ref={triggerRef}
      style={{
        display: 'inline-block',
        position: 'relative',
        ...(style as CSSProperties),
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
      onClick={() => {
        if (!shouldOpenOnLongPress) {
          setIsOpen((current) => !current);
        }
      }}
      onContextMenu={(event) => {
        if (shouldOpenOnLongPress) {
          event.preventDefault();
          setIsOpen(true);
        }
      }}
    >
      {children}

      {isOpen ? (
        <div
          role="menu"
          tabIndex={-1}
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 180,
            overflow: 'hidden',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            backgroundColor: '#ffffff',
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)',
          }}
        >
          {visibleActions.map((action) => (
            <button
              key={action.id ?? action.title}
              disabled={action.attributes?.disabled}
              role="menuitem"
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 12px',
                border: 0,
                background: 'transparent',
                color: action.attributes?.destructive ? '#b91c1c' : '#111827',
                cursor: action.attributes?.disabled ? 'not-allowed' : 'pointer',
                font: 'inherit',
                opacity: action.attributes?.disabled ? 0.5 : 1,
                textAlign: 'left',
              }}
              onClick={(event) => {
                event.stopPropagation();
                fireAction(action);
              }}
            >
              {action.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
