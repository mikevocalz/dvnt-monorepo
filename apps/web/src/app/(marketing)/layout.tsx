'use client';

/**
 * Marketing route-group layout — a dark canvas for the static marketing pages
 * (privacy, faq, pricing). Route groups don't affect the URL, so these still
 * live at /privacy, /faq, /pricing.
 *
 * Header AND footer come from the persistent SiteChrome in the root layout;
 * this layout only owns the background. Pages keep their ~156px top padding to
 * clear the fixed header.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', background: '#02030A', color: '#FAFAF9' }}>
      {children}
    </div>
  );
}
