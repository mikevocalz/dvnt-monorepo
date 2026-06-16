/**
 * Typing Indicator Component
 *
 * Shows animated dots when someone is typing, like Facebook/Instagram
 */

import { View, Text } from "react-native";
import { Motion } from "@legendapp/motion";
import { useEffect, useState } from "react";

interface TypingIndicatorProps {
  username?: string;
  visible: boolean;
}

export function TypingIndicator({ username, visible }: TypingIndicatorProps) {
  const [dots, setDots] = useState(0);

  // Animate dots
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 400);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <Motion.View
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      className="flex-row items-center px-4 py-2"
    >
      <View className="flex-row items-center bg-secondary rounded-2xl px-4 py-2.5">
        {/* Animated dots */}
        <View className="flex-row items-center gap-1 mr-2">
          {[0, 1, 2].map((i) => (
            <Motion.View
              key={i}
              animate={{
                scale: dots === i || dots === i + 1 ? 1.2 : 0.8,
                opacity: dots === i || dots === i + 1 ? 1 : 0.4,
              }}
              transition={{
                type: "spring",
                damping: 15,
                stiffness: 200,
              }}
              className="w-2 h-2 rounded-full bg-primary"
            />
          ))}
        </View>
        <Text className="text-muted-foreground text-sm">
          {username ? `${username} is typing` : "typing"}
        </Text>
      </View>
    </Motion.View>
  );
}

/**
 * Compact typing indicator for inline use
 */
export function TypingIndicatorInline({ visible }: { visible: boolean }) {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 400);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <View className="flex-row items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <Motion.View
          key={i}
          animate={{
            scale: dots === i || dots === i + 1 ? 1.3 : 0.7,
            opacity: dots === i || dots === i + 1 ? 1 : 0.3,
          }}
          transition={{
            type: "spring",
            damping: 12,
            stiffness: 180,
          }}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground"
        />
      ))}
    </View>
  );
}
