import { useColorScheme as useNativewindColorScheme } from "nativewind"
import { COLORS } from "@dvnt/app/theme/colors"

/**
 * DVNT is dark-only.
 *
 * This hook is imported by ~60 files, so it is the choke point that decides
 * whether any light-mode code path in the app can execute. It used to mirror
 * the device appearance (`colorScheme === "light" ? "light" : "dark"`), which
 * meant a phone set to Light flipped `isDarkColorScheme` to false and handed
 * every consumer the light palette. It now always reports dark, regardless of
 * the system setting or anything that called setColorScheme in the past.
 *
 * setColorScheme is still exported so existing callers compile, but it pins
 * dark — flipping the app to light is not a supported state.
 */
function useColorScheme() {
  const { setColorScheme } = useNativewindColorScheme()
  const resolvedColorScheme = "dark" as const

  function toggleColorScheme() {
    return setColorScheme("dark")
  }

  return {
    colorScheme: resolvedColorScheme,
    isDarkColorScheme: true,
    setColorScheme: () => setColorScheme("dark"),
    toggleColorScheme,
    colors: COLORS.dark,
  }
}

export { useColorScheme }
