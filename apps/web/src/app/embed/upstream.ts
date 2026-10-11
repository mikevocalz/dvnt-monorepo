/** Public edge-function transport. Never forwards site cookies or user credentials. */
export function ticketEmbedEndpoint() {
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  if(!base) throw new Error('Ticket embed backend is not configured.');
  return `${new URL(base).origin}/functions/v1/ticket-embed`;
}
export function ticketEmbedHeaders(origin?:string): Record<string,string> {
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return {'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...(key?{apikey:key}:{})};
}
