/**
 * @/components/list — Single blessed import path for all list components.
 *
 * LegendList is the ONLY allowed list implementation in Deviant.
 * FlatList, SectionList, VirtualizedList, and FlashList are BANNED.
 *
 * Usage:
 *   import { LegendList } from "@dvnt/app/components/list";
 *   import type { LegendListRef, LegendListProps, LegendListRenderItemProps } from "@dvnt/app/components/list";
 */

export { LegendList } from "@legendapp/list";
export type {
  LegendListProps,
  LegendListRef,
  LegendListRenderItemProps,
} from "@legendapp/list";
