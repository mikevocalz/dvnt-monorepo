import { LegalPage } from '@/components/legal/legal-page';

export const metadata = {
  title: 'FAQ · DVNT',
  description:
    'Membership, verification, safety, privacy, ads, and support — answered.',
};

export default function Page() {
  return <LegalPage variant="faq" />;
}
