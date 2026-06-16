import * as React from 'react'
import { View, TouchableOpacity, Text } from 'react-native'
import { cn } from '@/lib/cn'

type Ctx = { value: string; setValue: (v: string) => void }
const TabsContext = React.createContext<Ctx | null>(null)

interface TabsProps {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}

export function Tabs({ defaultValue, value: controlledValue, onValueChange, children, className }: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || '')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue
  
  const setValue = (v: string) => {
    if (!isControlled) setInternalValue(v)
    onValueChange?.(v)
  }
  
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <View className={cn('flex-1', className)}>{children}</View>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <View style={{ zIndex: 10 }} className={cn('flex-row rounded-xl bg-card p-1', className)}>{children}</View>
}

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

export function TabsTrigger({ value, children, className, disabled }: TabsTriggerProps) {
  const ctx = React.useContext(TabsContext)!
  const active = ctx.value === value
  
  const handlePress = () => {
    if (!disabled) {
      ctx.setValue(value)
    }
  }
  
  return (
    <TouchableOpacity 
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: active ? '#34A2DF' : 'transparent', opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </TouchableOpacity>
  )
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const ctx = React.useContext(TabsContext)!
  if (ctx.value !== value) return null
  return <View className={cn('flex-1', className)}>{children}</View>
}
