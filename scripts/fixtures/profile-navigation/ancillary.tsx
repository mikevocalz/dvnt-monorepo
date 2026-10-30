// Only unrelated marketing chrome, unread services and the JWT bridge are replaced.
// SiteChrome/AppShell/WebAppShell/WebTabBar/WebTopBar and their routing stay real.
export function GlassHeader() { return <header>Fixture public header</header>; }
export function Footer() { return <footer>Fixture public footer</footer>; }
export async function ensureSupabaseJwt() { return null; }
export const useVerifiedOnlyPromptStore = (select: (state: { open: boolean }) => unknown) => select({ open: false });

export const useBadges = () => ({ data: { unread: 0, total: 0 } });
export const useUnreadMessageCount = () => ({ data: 0, spamCount: 0 });
