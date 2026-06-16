import * as React from 'react'
import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native'
import { Eye, EyeOff } from 'lucide-react'

export interface InputProps extends React.ComponentPropsWithoutRef<typeof TextInput> {
  label?: string
  labelClassName?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

/**
 * Web Input. Styled with RN StyleSheet (NOT NativeWind `className`): in this Next
 * build className doesn't resolve on react-native-web components, so a
 * className-styled field collapses (no border/row layout → the password toggle
 * stacks under the input and heights break). StyleSheet `style` IS honored by
 * RNW (it compiles to atomic CSS), giving a real row-layout field.
 */
export const Input = React.forwardRef<TextInput, InputProps>(
  (
    { label, labelClassName, error, leftIcon, rightIcon, secureTextEntry, className, style, ...props },
    ref,
  ) => {
    const [hidden, setHidden] = React.useState(!!secureTextEntry)

    return (
      <View style={styles.wrap}>
        {label ? <Text style={styles.label}>{label}</Text> : null}

        <View style={[styles.field, error ? styles.fieldError : null]}>
          {leftIcon ? <View style={styles.left}>{leftIcon}</View> : null}

          <TextInput
            ref={ref}
            style={[styles.input, style]}
            placeholderTextColor="rgba(255,255,255,0.45)"
            secureTextEntry={hidden}
            {...props}
          />

          {secureTextEntry ? (
            <Pressable onPress={() => setHidden((v) => !v)} style={styles.toggle} hitSlop={8}>
              {hidden ? (
                <Eye size={18} color="rgba(255,255,255,0.65)" />
              ) : (
                <EyeOff size={18} color="rgba(255,255,255,0.65)" />
              )}
            </Pressable>
          ) : rightIcon ? (
            <View style={styles.toggle}>{rightIcon}</View>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    )
  },
)
Input.displayName = 'Input'

const styles = StyleSheet.create({
  wrap: { gap: 6, width: '100%' },
  label: { color: '#fff', fontSize: 14, fontWeight: '500' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 14,
  },
  fieldError: { borderColor: '#ef4444' },
  left: { marginRight: 8 },
  // outlineStyle:none removes RNW's web focus ring; cast since RN types omit it.
  input: ({
    flex: 1,
    height: '100%',
    color: '#fff',
    fontSize: 15,
    outlineStyle: 'none',
  } as unknown) as Record<string, unknown>,
  toggle: { marginLeft: 8, padding: 4 },
  error: { color: '#ef4444', fontSize: 13 },
})
