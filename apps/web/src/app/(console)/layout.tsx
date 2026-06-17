import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DVNT · Console",
  description: "DVNT moderation console.",
};

/**
 * Console root layout — owns its own <html>/<body> (the app root layout is a
 * pass-through). The moderation console is a self-contained dark dashboard with
 * NO public SiteChrome and NO react-native-web registry: it renders plain
 * semantic HTML + dashboard/ui.css. See app/(payload) and app/(frontend) for
 * the sibling roots.
 */
export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0c" }}>{children}</body>
    </html>
  );
}
