/**
 * Listener Grid Component
 * Responsive grid of listeners (non-speakers) in the room.
 * Uses LegendList for virtualization and shared Avatar component.
 * 3 columns on mobile, 5 columns on larger screens (≥768px).
 */

import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { memo, useCallback, useMemo } from "react";
import { LegendList } from "@/components/list";
import { Avatar } from "@/components/ui/avatar";
import { EyeOff, Mic } from "lucide-react-native";
import type { SneakyUser } from "../types";
import { getSneakyUserShortLabel } from "./user-labels";

const LARGE_SCREEN_BREAKPOINT = 768;
const GRID_GAP = 12;
const HORIZONTAL_PADDING = 20;

export interface Listener {
  id: string;
  user: SneakyUser;
}

interface ListenerGridProps {
  listeners: Listener[];
  isHost?: boolean;
  onPromote?: (userId: string) => void;
}

/** Chunk a flat array into rows of `cols` items */
function chunkArray<T>(arr: T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += cols) {
    rows.push(arr.slice(i, i + cols));
  }
  return rows;
}

const ListenerCell = memo(function ListenerCell({
  listener,
  cellSize,
  isHost,
  onPromote,
}: {
  listener: Listener;
  cellSize: number;
  isHost?: boolean;
  onPromote?: (userId: string) => void;
}) {
  const avatarSize = Math.min(cellSize - 8, 56);
  const label = getSneakyUserShortLabel(listener.user);
  return (
    <View style={{ width: cellSize, alignItems: "center" }}>
      <View>
        {listener.user.isAnonymous ? (
          <View
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            <EyeOff size={18} color="#94A3B8" />
          </View>
        ) : (
          <Avatar
            uri={listener.user.avatar}
            username={listener.user.username}
            size={avatarSize}
            variant="roundedSquare"
          />
        )}
        {isHost && onPromote && (
          <Pressable
            onPress={() => onPromote(listener.user.id)}
            hitSlop={8}
            style={{
              position: "absolute",
              bottom: -4,
              right: -4,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: "#3EA4E5",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: "#000",
            }}
          >
            <Mic size={12} color="#fff" />
          </Pressable>
        )}
      </View>
      <Text
        style={{
          fontSize: 11,
          color: "#9CA3AF",
          textAlign: "center",
          marginTop: 4,
          maxWidth: cellSize - 4,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
});

const ListenerRow = memo(function ListenerRow({
  row,
  cols,
  cellSize,
  isHost,
  onPromote,
}: {
  row: Listener[];
  cols: number;
  cellSize: number;
  isHost?: boolean;
  onPromote?: (userId: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: GRID_GAP,
        marginBottom: GRID_GAP,
      }}
    >
      {row.map((listener) => (
        <ListenerCell
          key={listener.id}
          listener={listener}
          cellSize={cellSize}
          isHost={isHost}
          onPromote={onPromote}
        />
      ))}
      {/* Fill empty cells to keep alignment */}
      {row.length < cols &&
        Array.from({ length: cols - row.length }).map((_, i) => (
          <View key={`empty-${i}`} style={{ width: cellSize }} />
        ))}
    </View>
  );
});

export function ListenerGrid({
  listeners,
  isHost,
  onPromote,
}: ListenerGridProps) {
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= LARGE_SCREEN_BREAKPOINT;
  const cols = isLargeScreen ? 5 : 3;

  const availableWidth = width - HORIZONTAL_PADDING * 2;
  const cellSize = (availableWidth - GRID_GAP * (cols - 1)) / cols;

  const rows = useMemo(() => chunkArray(listeners, cols), [listeners, cols]);

  const renderRow = useCallback(
    ({ item }: { item: Listener[] }) => (
      <ListenerRow
        row={item}
        cols={cols}
        cellSize={cellSize}
        isHost={isHost}
        onPromote={onPromote}
      />
    ),
    [cols, cellSize, isHost, onPromote],
  );

  const keyExtractor = useCallback(
    (item: Listener[], index: number) =>
      item.map((l) => l.id).join("-") || `row-${index}`,
    [],
  );

  if (listeners.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: HORIZONTAL_PADDING, marginBottom: 24 }}>
      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: "#fff",
          marginBottom: 16,
        }}
      >
        Listeners ({listeners.length})
      </Text>
      <LegendList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        estimatedItemSize={cellSize + 24}
        scrollEnabled={false}
        recycleItems
      />
    </View>
  );
}
