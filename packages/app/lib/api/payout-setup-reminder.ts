import { invokeEdge } from './invoke-edge';
export interface PayoutSetupReminderResponse {
  ok: true;
  eligible: boolean;
  needsSetup: boolean;
  role?: 'organizer' | 'promoter';
  route?: string;
  state?: 'setup' | 'action_required' | 'reviewing';
}
export async function checkPayoutSetupReminder():Promise<PayoutSetupReminderResponse> {
  const result=await invokeEdge<PayoutSetupReminderResponse & {error?:string}>('payout-setup-reminder',{action:'status'});
  if(result.error || !result.data?.ok)throw new Error(result.error?.message||result.data?.error||'Payout status unavailable');
  return result.data;
}
