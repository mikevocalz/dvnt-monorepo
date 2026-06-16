import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { mmkvStorage } from '@/lib/mmkv-zustand'

export type Locale = 'en'

type PreferencesState = {
  locale: Locale
  setLocale: (l: Locale) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => set({ locale })
    }),
    { name: 'preferences', storage: mmkvStorage }
  )
)
