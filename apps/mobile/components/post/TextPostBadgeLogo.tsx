import { memo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Logo from "@/components/logo";

interface TextPostBadgeLogoProps {
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
}

function TextPostBadgeLogoComponent({
  width,
  height,
  style,
}: TextPostBadgeLogoProps) {
  return (
    <View
      style={[
        {
          width,
          height,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Logo width={width} height={height} />
    </View>
  );
}

export const TextPostBadgeLogo = memo(TextPostBadgeLogoComponent);
