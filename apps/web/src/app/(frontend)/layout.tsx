import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { ApiProvider } from "@dvnt/api";
import { ImageProvider } from "@dvnt/ui/image-provider";
import { SiteChrome } from "@/components/site-chrome";
import { RNWStyleRegistry } from "./registry";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "dvnt.app | connect. gather. move.",
  description: "DVNT app exists to create an intentional space for queer people to connect, gather, and move culture on their own terms.",
};

function getSolitoNextUrl(): `http:${string}` | `https:${string}` {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  return url?.startsWith("http://") || url?.startsWith("https://")
    ? (url as `http:${string}` | `https:${string}`)
    : "http://localhost:3000";
}

/**
 * Frontend root layout — owns the <html>/<body> for the public DVNT site
 * (Solito screens, blog, events). Lives in the (frontend) route group so the
 * Payload admin in (payload) can render its OWN <html>/<body> without the
 * site chrome or react-native-web registry wrapping it. The top-level
 * app/layout.tsx is a pass-through that delegates to these per-group roots.
 */
export default function FrontendLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/* Deviant top progress bar. The gradient + glow are themed in
            globals.css (#nprogress overrides); color here is the fallback. */}
        <NextTopLoader
          color="#FF5BFC"
          height={3}
          shadow="0 0 12px #FF5BFC, 0 0 8px #3FDCFF"
          showSpinner={false}
          easing="cubic-bezier(0.22,1,0.36,1)"
          speed={400}
        />
        <RNWStyleRegistry>
          <ImageProvider nextJsURL={getSolitoNextUrl()}>
            <ApiProvider>
              {/* Persistent header + footer wrapping every page — mounted once
                  at the root, so the chrome never remounts/jumps on navigation. */}
              <SiteChrome>{children}</SiteChrome>
            </ApiProvider>
          </ImageProvider>
        </RNWStyleRegistry>
      </body>
    </html>
  );
}
