import { create } from "zustand";

interface SignupFormData {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  dateOfBirth: string;
  password: string;
  confirmPassword: string;
}

interface IDVerification {
  idImage: string | null;
  faceImage: string | null;
  isVerified: boolean;
  extractedDOB: string | null;
  isOver18: boolean | null;
  // CRITICAL: Age block flag - if true, user cannot proceed
  isAgeBlocked: boolean;
}

interface SignupStore {
  activeStep: number;
  formData: SignupFormData;
  idVerification: IDVerification;
  hasScrolledToBottom: boolean;
  termsAccepted: boolean;
  isSubmitting: boolean;
  setActiveStep: (step: number) => void;
  updateFormData: (data: Partial<SignupFormData>) => void;
  setIDImage: (image: string) => void;
  setFaceImage: (image: string) => void;
  setVerified: (verified: boolean) => void;
  setExtractedDOB: (dob: string | null, isOver18: boolean | null) => void;
  setHasScrolledToBottom: (scrolled: boolean) => void;
  setTermsAccepted: (accepted: boolean) => void;
  setIsSubmitting: (submitting: boolean) => void;
  resetSignup: () => void;
}

const initialFormData: SignupFormData = {
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  phone: "",
  dateOfBirth: "",
  password: "",
  confirmPassword: "",
};

const initialIdVerification: IDVerification = {
  idImage: null,
  faceImage: null,
  isVerified: false,
  extractedDOB: null,
  isOver18: null,
  isAgeBlocked: false,
};

export const useSignupStore = create<SignupStore>((set) => ({
  activeStep: 0,
  formData: initialFormData,
  idVerification: initialIdVerification,
  hasScrolledToBottom: false,
  termsAccepted: false,
  isSubmitting: false,
  setActiveStep: (step) => set({ activeStep: step }),
  updateFormData: (data) =>
    set((state) => ({
      formData: { ...state.formData, ...data },
    })),
  setIDImage: (image) =>
    set((state) => ({
      idVerification: { ...state.idVerification, idImage: image },
    })),
  setFaceImage: (image) =>
    set((state) => ({
      idVerification: { ...state.idVerification, faceImage: image },
    })),
  setVerified: (verified) =>
    set((state) => ({
      idVerification: { ...state.idVerification, isVerified: verified },
    })),
  setExtractedDOB: (dob, isOver18) =>
    set((state) => ({
      idVerification: { ...state.idVerification, extractedDOB: dob, isOver18 },
    })),
  setHasScrolledToBottom: (scrolled) => set({ hasScrolledToBottom: scrolled }),
  setTermsAccepted: (accepted) => set({ termsAccepted: accepted }),
  setIsSubmitting: (submitting) => set({ isSubmitting: submitting }),
  resetSignup: () =>
    set({
      activeStep: 0,
      formData: initialFormData,
      idVerification: initialIdVerification,
      hasScrolledToBottom: false,
      termsAccepted: false,
      isSubmitting: false,
    }),
}));
