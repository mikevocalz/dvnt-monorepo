import { notFound } from 'next/navigation';
import { TicketEmbedSettingsScreen } from '@dvnt/app/features/events/ui/ticket-embed-settings.web';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.TICKET_EMBED_BUILDER_ENABLED === 'false') notFound();
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <TicketEmbedSettingsScreen eventId={Number(id)} />;
}
