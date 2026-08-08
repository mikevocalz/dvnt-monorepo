// ============================================================
// ToolPanelContainer — @gorhom/bottom-sheet powered tool panels
// ============================================================
// Uses plain BottomSheet (not BottomSheetModal) for reliable
// slide-up behavior inside nested navigation stacks.
// BottomSheetModal uses portals which can fail in deep stacks.
// ============================================================

import React, { useCallback, useRef, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";

interface ToolPanelContainerProps {
  visible: boolean;
  onDismiss: () => void;
  /** Panel height as percentage of screen (0-1). Default 0.42 */
  heightRatio?: number;
  children: React.ReactNode;
}

export const ToolPanelContainer: React.FC<ToolPanelContainerProps> = React.memo(
  ({ visible, onDismiss, heightRatio = 0.42, children }) => {
    const sheetRef = useRef<BottomSheet>(null);
    const { height: screenH } = useWindowDimensions();

    const snapPoints = useMemo(
      () => [Math.round(screenH * heightRatio)],
      [screenH, heightRatio],
    );

    const handleSheetChange = useCallback(
      (index: number) => {
        if (index === -1) {
          onDismiss();
        }
      },
      [onDismiss],
    );

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.4}
          pressBehavior="close"
        />
      ),
      [],
    );

    if (!visible) return null;

    return (
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: "#1a1a1a",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        }}
        handleIndicatorStyle={{
          backgroundColor: "#555",
          width: 36,
          height: 4,
        }}
        handleStyle={{
          paddingTop: 10,
          paddingBottom: 6,
        }}
      >
        <BottomSheetView style={{ flex: 1 }}>{children}</BottomSheetView>
      </BottomSheet>
    );
  },
);

ToolPanelContainer.displayName = "ToolPanelContainer";
