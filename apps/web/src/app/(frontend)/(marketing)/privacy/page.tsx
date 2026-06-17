import { LegalPage } from '@/components/legal/legal-page';

export const metadata = {
  title: 'Privacy, safety & terms · DVNT',
  description:
    'DVNT is built around privacy, autonomy, verification, and protection for a human-only community.',
};

export default function Page() {
  return <LegalPage variant="privacy" />;
}
