'use client';
/** Native browser controls live in the UI boundary, not in feature screens. */
export function EventWidgetFrame({id,width}:{id:string;width:string}){
 return <iframe title="Live DVNT event ticket widget" src={`/tickets/embed/${encodeURIComponent(id)}`} sandbox="allow-popups allow-popups-to-escape-sandbox" style={{width,maxWidth:'100%',height:980,border:0,borderRadius:16}}/>;
}
export function EventWidgetCode({code}:{code:string}){
 return <textarea aria-label="Event iframe embed code" readOnly value={code} onFocus={e=>e.currentTarget.select()} rows={5} style={{width:'100%',minHeight:130,resize:'vertical',borderRadius:12,padding:12,background:'#111116',color:'white',border:'1px solid #ffffff26',fontFamily:'monospace'}}/>;
}
