import { notFound } from 'next/navigation';
import { TicketEmbedSettingsScreen } from '@dvnt/app/features/events/ui/ticket-embed-settings.web';

// /embed stays the existing-checkout handoff widget. This route is isolated.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.TICKET_EMBED_BUILDER_ENABLED === 'false') notFound();
  const { id } = await params;
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <TicketEmbedSettingsScreen eventId={Number(id)} />;
}
