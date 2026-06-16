import { View } from "react-native";
import { User } from "lucide-react";

interface AvatarImageProps {
  uri?: string | null;
  size?: number;
  className?: string;
  showPlaceholder?: boolean;
}

export function AvatarImage({
  uri,
  size = 40,
  className = "",
  showPlaceholder = true,
}: AvatarImageProps) {
  const showFallback = !uri;
  const borderRadius = Math.min(Math.round(size * 0.18), 16);

  if (showFallback && showPlaceholder) {
    return (
      <View
        className={`bg-muted items-center justify-center ${className}`}
        style={{ width: size, height: size, borderRadius }}
      >
        <User size={size * 0.5} color="#666" />
      </View>
    );
  }

  if (showFallback) {
    return (
      <View
        className={`bg-muted ${className}`}
        style={{ width: size, height: size, borderRadius }}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius, overflow: "hidden" }}
      className={className}
    >
      <img
        src={uri!}
        style={{ width: size, height: size, objectFit: "cover", display: "block" }}
        alt=""
      />
    </View>
  );
}

export function SmallAvatar({ uri, className }: { uri?: string | null; className?: string }) {
  return <AvatarImage uri={uri} size={32} className={className} />;
}

export function MediumAvatar({ uri, className }: { uri?: string | null; className?: string }) {
  return <AvatarImage uri={uri} size={40} className={className} />;
}

export function LargeAvatar({ uri, className }: { uri?: string | null; className?: string }) {
  return <AvatarImage uri={uri} size={80} className={className} />;
}

export function XLargeAvatar({ uri, className }: { uri?: string | null; className?: string }) {
  return <AvatarImage uri={uri} size={120} className={className} />;
}
