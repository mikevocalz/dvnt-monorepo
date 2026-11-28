/** Actor comes from verified session, never from request body. */
export async function readSettlementSummary(db:any,actor:string,eventId:number){
 try {
  const {data,error}=await db.rpc('settlement_actor_summary',{p_actor:actor,p_event_id:eventId});
  if(error||data?.verified!==true||!Array.isArray(data.rows))return {verified:false,rows:[]};
  return data;
 }catch{return {verified:false,rows:[]};}
}
