import MenuViewBase from '@expo/ui/community/menu';
import { styled } from 'nativewind';

export type {
  MenuAction,
  MenuAttributes,
  MenuComponentProps as MenuViewProps,
  MenuComponentRef,
  MenuState,
  NativeActionEvent,
} from '@expo/ui/community/menu';

export const MenuView = styled(MenuViewBase, {
  className: { target: 'style' },
});
