import * as React from 'react'
import { TextInput, View, Text, Pressable, Platform } from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'
import { cn } from '@/lib/cn'

export interface InputProps extends React.ComponentPropsWithoutRef<typeof TextInput> {
  label?: string
  labelClassName?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = React.forwardRef<TextInput, InputProps>(
  ({ label, labelClassName, error, leftIcon, rightIcon, secureTextEntry, className, ...props }, ref) => {
    const [hidden, setHidden] = React.useState(!!secureTextEntry)

    return (
      <View className="gap-1">
        {label ? <Text className={cn("text-sm font-medium", labelClassName || "text-muted")}>{label}</Text> : null}

        <View className={cn('flex-row items-center rounded-xl border px-3', error ? 'border-destructive' : 'border-border', 'bg-card')}>
          {leftIcon ? <View className="mr-2">{leftIcon}</View> : null}

          <TextInput
            ref={ref}
            className={cn('flex-1 py-3 text-sm text-foreground', className)}
            // iOS: explicit lineHeight prevents descenders (g, y, p, …) from
            // being clipped at the bottom of the input. RN's default line
            // box is slightly shorter than the font's own line box, which
            // caused the cut-off look users reported.
            // Android: `includeFontPadding: false` + textAlignVertical
            // keeps the baseline tight and vertically centered.
            style={
              Platform.OS === 'android'
                ? { textAlignVertical: 'center', includeFontPadding: false }
                : { lineHeight: 20 }
            }
            placeholderTextColor="rgba(255,255,255,0.45)"
            secureTextEntry={hidden}
            {...props}
          />

          {secureTextEntry ? (
            <Pressable onPress={() => setHidden((v) => !v)} className="ml-2">
              {hidden ? <Eye size={18} color="rgba(255,255,255,0.65)" /> : <EyeOff size={18} color="rgba(255,255,255,0.65)" />}
            </Pressable>
          ) : rightIcon ? (
            <View className="ml-2">{rightIcon}</View>
          ) : null}
        </View>

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
      </View>
    )
  }
)
Input.displayName = 'Input'
