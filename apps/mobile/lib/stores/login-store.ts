import { create } from "zustand"

interface LoginStore {
  email: string
  password: string
  showPassword: boolean
  isLoading: boolean
  setEmail: (email: string) => void
  setPassword: (password: string) => void
  toggleShowPassword: () => void
  setIsLoading: (loading: boolean) => void
  resetLogin: () => void
}

export const useLoginStore = create<LoginStore>((set) => ({
  email: "",
  password: "",
  showPassword: false,
  isLoading: false,
  setEmail: (email) => set({ email }),
  setPassword: (password) => set({ password }),
  toggleShowPassword: () => set((state) => ({ showPassword: !state.showPassword })),
  setIsLoading: (loading) => set({ isLoading: loading }),
  resetLogin: () =>
    set({
      email: "",
      password: "",
      showPassword: false,
      isLoading: false,
    }),
}))
