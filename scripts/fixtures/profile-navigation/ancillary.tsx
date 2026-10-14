// Only unrelated marketing chrome and the JWT network bridge are replaced.
// SiteChrome/AppShell/WebAppShell/WebTabBar/WebTopBar and their routing stay real.
export function GlassHeader() { return <header>Fixture public header</header>; }
export function Footer() { return <footer>Fixture public footer</footer>; }
export async function ensureSupabaseJwt() { return null; }
export const useVerifiedOnlyPromptStore = (select: (state: { open: boolean }) => unknown) => select({ open: false });
