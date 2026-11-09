/** Future comp orders have a dedicated receipt. Never send them a second time
 * through the legacy guest checkout retry sweep. No history is enrolled here. */
export async function excludeReceiptManagedOrders<T extends {id: string}>(db: any, orders: T[]): Promise<T[]> {
  if (!orders.length) return [];
  const {data, error} = await db.from('ticket_receipt_outbox').select('source_id')
    .eq('source_kind', 'guest_comp').in('source_id', orders.map(order => order.id));
  // Fail closed on queue lookup failure: defer mail, never risk duplicate sends.
  if (error || !Array.isArray(data)) return [];
  const managed = new Set(data.map((row: {source_id:string}) => row.source_id));
  return orders.filter(order => !managed.has(order.id));
}
