interface Ring { active: string; keys: Map<string, {enc:CryptoKey;mac:CryptoKey}> }
interface IssueInput {
  eventId: number; actor: string; requestId: string; email: string; role: string; from: string; webOrigin: string;
}
interface Envelope {
  event_id:number; issued_by:string; request_id:string; invite_hash:string; intent_digest:string;
  key_id:string; offered_role:string; accept_intent_digests:string[]; nonce:string;
  ciphertext:string; email:string; token:string;
}
export function keyring(active:string, material:Map<string,Uint8Array>): Promise<Ring>;
export function prepareIssue(input:IssueInput, keys:Ring, render:(claim:string)=>{subject:string;html:string}): Promise<Envelope>;
