
import { View, Text } from 'react-native'

export function NotFoundScreen() {
  return (
    <View className="min-h-screen w-full  flex-1 items-center bg-teal-600 p-3 ">
      <Text className="font-bold text-red-700">Error 404 - Not Found</Text>
    </View>
  )
}
