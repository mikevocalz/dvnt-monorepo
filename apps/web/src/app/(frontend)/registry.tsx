'use client'

import { useServerInsertedHTML } from 'next/navigation'
import { useRef } from 'react'
import { StyleSheet } from 'react-native'

export function RNWStyleRegistry({ children }: { children: React.ReactNode }) {
  const isServerInserted = useRef(false)

  useServerInsertedHTML(() => {
    if (isServerInserted.current) return
    isServerInserted.current = true

    // Flush react-native-web's atomic CSS into the SSR'd <head>
    // so client-side class names match and hydration succeeds.
    // getSheet() exists in react-native-web but is missing from RN types.
    const sheet = (StyleSheet as unknown as {
      getSheet: () => { id: string; textContent: string }
    }).getSheet()
    return (
      <style
        dangerouslySetInnerHTML={{ __html: sheet.textContent }}
        id={sheet.id}
      />
    )
  })

  return <>{children}</>
}
