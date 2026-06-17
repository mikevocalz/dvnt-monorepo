/**
 * Root pass-through layout.
 *
 * Next.js allows a single root layout, but this app hosts two isolated shells
 * that each need their own <html>/<body>:
 *   - (frontend) → the public DVNT site (Solito screens, blog, events)
 *   - (payload)  → the Payload admin + REST/GraphQL API
 *   - (console)  → the internal moderation dashboard
 * So the real <html>/<body> live in each group's own layout, and this root
 * simply forwards children. Do NOT add html/body/providers here — it would
 * leak the site chrome into the Payload admin.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
