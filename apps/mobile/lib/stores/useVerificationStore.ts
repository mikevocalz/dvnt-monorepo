import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { mmkvStorage } from '@/lib/mmkv-zustand'

export type ParsedId = {
  firstName?: string
  lastName?: string
  dob?: string
  documentNumber?: string
}

type VerificationState = {
  idImageUri: string | null
  faceImageUri: string | null
  parsedId: ParsedId | null
  idComplete: boolean
  faceComplete: boolean

  setIdImageUri: (uri: string) => void
  setFaceImageUri: (uri: string) => void
  setParsedId: (data: ParsedId) => void
  setIdComplete: (v: boolean) => void
  setFaceComplete: (v: boolean) => void
  reset: () => void
}

export const useVerificationStore = create<VerificationState>()(
  persist(
    (set) => ({
      idImageUri: null,
      faceImageUri: null,
      parsedId: null,
      idComplete: false,
      faceComplete: false,

      setIdImageUri: (idImageUri) => set({ idImageUri }),
      setFaceImageUri: (faceImageUri) => set({ faceImageUri }),
      setParsedId: (parsedId) => set({ parsedId }),
      setIdComplete: (idComplete) => set({ idComplete }),
      setFaceComplete: (faceComplete) => set({ faceComplete }),

      reset: () =>
        set({
          idImageUri: null,
          faceImageUri: null,
          parsedId: null,
          idComplete: false,
          faceComplete: false
        })
    }),
    { name: 'verification', storage: mmkvStorage }
  )
)
