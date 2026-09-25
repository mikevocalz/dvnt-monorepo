import { Stack } from "expo-router";
export default function GameNightLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }}><Stack.Screen name="index" /><Stack.Screen name="join" /><Stack.Screen name="room/[code]" options={{ gestureEnabled: false }} /></Stack>;
}
