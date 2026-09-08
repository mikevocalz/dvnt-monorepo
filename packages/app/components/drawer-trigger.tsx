/**
 * The drawer's visible trigger.
 *
 * Present on every top-level surface. Discovering a gesture is never a
 * requirement for reaching a menu — an edge swipe is an accelerant for people
 * who already know the menu is there.
 */

import { Pressable, View } from "react-native";
import { Menu } from "lucide-react-native";
import { useDrawerStore } from "@dvnt/app/lib/stores/drawer-store";
import { color } from "@dvnt/app/lib/theme";

export function DrawerTrigger({ badge = 0 }: { badge?: number }) {
  const openDrawer = useDrawerStore((s) => s.openDrawer);

  return (
    <Pressable
      onPress={openDrawer}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={
        badge > 0 ? `Menu, ${badge} items need your attention` : "Menu"
      }
      accessibilityHint="Opens your tickets, orders, and settings"
      style={{
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Menu size={24} color={color.text} />
      {badge > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: color.violet,
            borderWidth: 2,
            borderColor: color.ink,
          }}
        />
      ) : null}
    </Pressable>
  );
}
