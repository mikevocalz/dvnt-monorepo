import { useRef } from 'react'

export function useScanStability(onStable: () => void, stableFrames = 3) {
  const last = useRef<string>('')
  const count = useRef<number>(0)
  const locked = useRef<boolean>(false)

  return (blocks: { text: string }[]) => {
    if (locked.current) return
    const text = blocks.map((b) => b.text).join(' ').trim()

    if (!text) return

    if (text === last.current) count.current += 1
    else {
      last.current = text
      count.current = 0
    }

    if (count.current >= stableFrames) {
      locked.current = true
      onStable()
    }
  }
}
