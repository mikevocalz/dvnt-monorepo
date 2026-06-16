'use client';

import dynamic from 'next/dynamic';

const LegalPage = dynamic(
  () => import('@dvnt/app/features/settings/legal-page.web').then((m) => m.LegalPage),
  { ssr: false },
);

export default function Page() {
  return <LegalPage slug="terms-of-service" title="Terms of Service" />;
}
