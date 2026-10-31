/** Tab-local continuation of a signup created here, never an admission grant. */
const KEY = 'dvnt:signup:continuation';
export function rememberSignupContinuation(authId: string): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ authId, savedAt: Date.now() })); } catch { /* optional */ }
}
export function hasSignupContinuation(authId: string): boolean {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    const age = Date.now() - saved?.savedAt;
    return saved?.authId === authId && Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000;
  } catch { return false; }
}
export function clearSignupContinuation(): void {
  try { window.sessionStorage.removeItem(KEY); window.sessionStorage.removeItem('dvnt:signup:verification'); } catch { /* optional */ }
}
