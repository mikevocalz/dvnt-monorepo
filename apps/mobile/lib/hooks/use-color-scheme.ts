import { useColorScheme as useNativewindColorScheme } from "nativewind"
import { COLORS } from "@/theme/colors"

function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativewindColorScheme()
  const resolvedColorScheme = colorScheme === "light" ? "light" : "dark"

  function toggleColorScheme() {
    return setColorScheme(resolvedColorScheme === "light" ? "dark" : "light")
  }

  return {
    colorScheme: resolvedColorScheme,
    isDarkColorScheme: resolvedColorScheme === "dark",
    setColorScheme,
    toggleColorScheme,
    colors: COLORS[resolvedColorScheme],
  }
}

export { useColorScheme }
