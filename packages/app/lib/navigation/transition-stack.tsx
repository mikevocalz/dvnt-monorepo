import type { ComponentProps } from "react";
import { Stack } from "expo-router";

/**
 * Custom-transition stack.
 *
 * This used to build its own navigator with createNativeStackNavigator() +
 * withLayoutContext(), importing @react-navigation/native-stack directly.
 * Expo Router SDK 56+ rejects that import at bundle time (a second navigator
 * instance can desync from the router's own navigation context), and it bought
 * nothing: expo-router's Stack IS a withLayoutContext-wrapped native stack with
 * the same NativeStackNavigationOptions, so per-screen animation/presentation
 * options behave identically.
 *
 * Kept as a named re-export so the call sites that do
 * `import { TransitionStack as Stack }` stay untouched.
 */
export const TransitionStack = Stack;

/**
 * Options type for TransitionStack screens.
 *
 * Do NOT import NativeStackNavigationOptions from @react-navigation/native-stack
 * for these: expo-router vendors its own copy of that package, so the top-level
 * one is a structurally different type and every options object is rejected.
 * Deriving from Stack.Screen pins this to whichever copy the router actually
 * uses. The Exclude drops the callback form of the `options` prop.
 */
export type TransitionStackOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack.Screen>["options"]>,
  (...args: never[]) => unknown
>;
