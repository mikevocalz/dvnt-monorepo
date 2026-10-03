/**
 * Native: let the host pick one phone number from their contacts.
 *
 * Uses the system picker (CNContactPickerViewController on iOS,
 * ACTION_PICK on Android). The picker hands back only the contact the host
 * chose, so DVNT never reads the address book and asks for no contacts
 * permission on iOS. Nothing picked here is stored: the number goes into the
 * recipients box like a typed one.
 *
 * Web has no picker: pick-contact-phone.web.ts.
 */
import { presentContactPickerAsync } from "expo-contacts/legacy";

export const canPickContact = true;

export interface PickedPhone {
  name: string | null;
  /** Every number on the contact, as stored. The server normalizes. */
  numbers: string[];
}

export async function pickContactPhone(): Promise<PickedPhone | null> {
  const contact = await presentContactPickerAsync();
  if (!contact) return null;
  const numbers = (contact.phoneNumbers ?? [])
    .map((p) => (p.number ?? p.digits ?? "").trim())
    .filter(Boolean);
  return { name: contact.name ?? null, numbers };
}
