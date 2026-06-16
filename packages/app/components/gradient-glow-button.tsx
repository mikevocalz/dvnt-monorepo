import { Pressable, View, Platform } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { Plus } from "lucide-react-native"

interface GradientGlowButtonProps {
  onPress: () => void
  size?: number
  iconSize?: number
  focused?: boolean
}

export function GradientGlowButton({ 
  onPress, 
  size = 56, 
  iconSize = 28,
  focused = false
}: GradientGlowButtonProps) {
  const gradientColors = ["#34A2DF", "#8A40CF", "#FF5BFC"] as const

  const buttonContent = (
    <Pressable 
      onPress={onPress} 
      className="shadow-lg shadow-purple"
      style={{ elevation: 8 }}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="items-center justify-center"
        style={{ width: size, height: size, borderRadius: size / 2 }}
      >
        <Plus size={iconSize} color="#fff" strokeWidth={2.5} />
      </LinearGradient>
    </Pressable>
  )

  if (Platform.OS === "web") {
    return (
      <View className="items-center justify-center -mt-[30px]">
        <View 
          className="absolute bg-purple/30"
          style={{ 
            width: size + 20, 
            height: size + 20, 
            borderRadius: (size + 20) / 2,
            shadowColor: "#8A40CF",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 20,
          }} 
        />
        {buttonContent}
      </View>
    )
  }

  return (
    <View className="items-center justify-center -mt-[30px]">
      <View 
        className="absolute bg-purple/25"
        style={{ 
          width: size + 20, 
          height: size + 20, 
          borderRadius: (size + 20) / 2,
          shadowColor: "#8A40CF",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 16,
          elevation: 12,
        }} 
      />
      {buttonContent}
    </View>
  )
}
