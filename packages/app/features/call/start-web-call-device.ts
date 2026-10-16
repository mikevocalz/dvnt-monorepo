/** Fishjam toggles resolve with DeviceError; they do not necessarily reject. */
export async function startWebCallDevice(
  isOn: () => boolean,
  toggle: () => Promise<undefined | { name: string }>,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return false;
  return isOn() || changeWebCallDevice(toggle, isCancelled);
}

/** Run a toggle/selection without allowing a stale completion to update UI. */
export async function changeWebCallDevice(
  change: () => Promise<undefined | { name: string }>,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return false;
  let error: undefined | { name: string };
  try {
    error = await change();
  } catch (cause) {
    if (isCancelled()) return false;
    throw cause;
  }
  // Never let a late permission result update a reset/remounted call store.
  if (isCancelled()) return false;
  if (error) throw Object.assign(new Error(`Media device failed: ${error.name}`), { name: error.name });
  return true;
}
