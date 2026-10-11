import { invokeEdge } from './invoke-edge';

export interface TicketEmbedSettings {
  id: string;
  event_id: number;
  allowed_origin: string;
  revision: number;
  status: 'draft' | 'revoked';
  updated_at: string;
}
export interface TicketEmbedBuilderData {
  ok: true;
  role: 'owner' | 'admin';
  settings: TicketEmbedSettings | null;
  canGenerate: false;
  event: { id: number; title: string; startDate: string | null; timeZone?: string | null; location: string; flyerUrl: string | null };
}

async function request(body: Record<string, unknown>): Promise<TicketEmbedBuilderData> {
  const { data, error } = await invokeEdge<TicketEmbedBuilderData & { error?: string }>('manage-ticket-embed', body);
  if (error) throw new Error(error.message);
  if (!data?.ok || data.error) throw new Error(data?.error || 'Could not load embed settings.');
  return data;
}
export const ticketEmbedsApi = {
  get: (eventId: number) => request({ action: 'get', event_id: eventId }),
  save: (eventId: number, origin: string, revision: number) => request({ action: 'save', event_id: eventId, allowed_origin: origin, expected_revision: revision }),
  revoke: (eventId: number, revision: number) => request({ action: 'revoke', event_id: eventId, expected_revision: revision }),
};
