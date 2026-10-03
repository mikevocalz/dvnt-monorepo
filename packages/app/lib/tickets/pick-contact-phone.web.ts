/** Web has no contact picker. The host types the number. */
export const canPickContact = false;

export interface PickedPhone {
  name: string | null;
  numbers: string[];
}

export async function pickContactPhone(): Promise<PickedPhone | null> {
  return null;
}
