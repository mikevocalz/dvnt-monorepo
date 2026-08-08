import { View, Text } from 'react-native'

export function FaceGuidanceBanner({ hint, lightingMessage }: { hint: string; lightingMessage?: string }) {
  return (
    <View className="absolute left-0 right-0 bottom-28 px-6">
      <View className="rounded-xl px-4 py-3 bg-black/60">
        <Text className="text-white text-base">{hint}</Text>
        {lightingMessage ? <Text className="text-white/80 text-sm mt-1">{lightingMessage}</Text> : null}
      </View>
    </View>
  )
}
