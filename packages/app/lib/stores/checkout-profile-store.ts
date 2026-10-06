/**
 * The four profile fields a guest gives at checkout, shared by the web sheet
 * and the native sheet. Email stays in each sheet's own state; this holds
 * username, full name, phone and the live username check.
 */
import { create } from "zustand";
import { supabase } from "@dvnt/app/lib/supabase/client";
import {
  createUsernameAvailability,
  IDLE,
  type UsernameState,
} from "@dvnt/app/lib/checkout/username-availability";
import {
  parseCheckoutProfileFields,
  type CheckoutProfileFields,
} from "@dvnt/app/lib/checkout/profile-fields";

interface CheckoutProfileState {
  username: string;
  fullName: string;
  phone: string;
  usernameCheck: UsernameState;
  setUsername: (value: string) => void;
  setFullName: (value: string) => void;
  setPhone: (value: string) => void;
  reset: () => void;
  /**
   * The normalized fields for the request, or the first problem in the
   * order the fields appear on screen.
   */
  validate: (email: string) => { ok: true; fields: CheckoutProfileFields } | { ok: false; message: string };
}

async function checkUsernameOnServer(username: string) {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    available?: boolean;
    message?: string;
  }>("checkout-username", { body: { username } });
  if (error || !data?.ok) throw error ?? new Error("check failed");
  return { available: data.available === true, message: data.message ?? null };
}

export const useCheckoutProfileStore = create<CheckoutProfileState>((set, get) => {
  const availability = createUsernameAvailability({
    check: checkUsernameOnServer,
    onChange: (usernameCheck) => set({ usernameCheck }),
  });
  return {
    username: "",
    fullName: "",
    phone: "",
    usernameCheck: IDLE,
    setUsername: (username) => {
      set({ username });
      availability.input(username);
    },
    setFullName: (fullName) => set({ fullName }),
    setPhone: (phone) => set({ phone }),
    reset: () => {
      availability.dispose();
      set({ username: "", fullName: "", phone: "", usernameCheck: IDLE });
    },
    validate: (email) => {
      const s = get();
      if (s.usernameCheck.status === "taken") {
        return { ok: false, message: "That username is taken. Try another." };
      }
      const parsed = parseCheckoutProfileFields({
        guest_email: email,
        username: s.username || "-",
        full_name: s.fullName,
        phone: s.phone,
      });
      if (!parsed.ok) return { ok: false, message: parsed.message };
      // parse returns null only when every field is blank, which the
      // placeholder username above rules out.
      return parsed.fields
        ? { ok: true, fields: parsed.fields }
        : { ok: false, message: "Choose a username." };
    },
  };
});
