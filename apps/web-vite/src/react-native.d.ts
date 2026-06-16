// Ambient react-native types for the web-vite app. The moderation dashboard is
// now plain HTML, but the blog views/components use react-native(-web), which
// ships no TS types — and this app doesn't depend on `react-native` itself.
// vite.config aliases `react-native` → `react-native-web` at build; these give
// tsc the minimal surface used. Styles are intentionally loose.
declare module 'react-native' {
  import type { ComponentType, ReactNode, Ref } from 'react'

  export type StyleProp = any
  type Common = { style?: StyleProp; children?: ReactNode; [key: string]: any }

  export const View: ComponentType<Common>
  export const Text: ComponentType<Common>
  export const Pressable: ComponentType<Common & { onPress?: (event?: any) => void; disabled?: boolean }>
  export const ScrollView: ComponentType<Common & { contentContainerStyle?: StyleProp; ref?: Ref<any> }>
  export const Image: ComponentType<{ source?: { uri: string }; style?: StyleProp }>
  export const TextInput: ComponentType<{
    value?: string
    onChangeText?: (v: string) => void
    placeholder?: string
    placeholderTextColor?: string
    secureTextEntry?: boolean
    multiline?: boolean
    numberOfLines?: number
    maxLength?: number
    keyboardType?: string
    style?: StyleProp
  }>

  export const StyleSheet: {
    create<T extends Record<string, any>>(styles: T): T
    flatten(style?: StyleProp): any
    absoluteFill: any
    hairlineWidth: number
  }

  export function useWindowDimensions(): { width: number; height: number; scale: number; fontScale: number }
}
