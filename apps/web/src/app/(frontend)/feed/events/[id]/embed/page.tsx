import { notFound } from 'next/navigation';
import { EventWidgetScreen } from '@dvnt/app/features/events/ui/event-widget.web';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const eventId=Number(id);if(!Number.isSafeInteger(eventId)||eventId<=0)notFound();
 return <EventWidgetScreen eventId={eventId}/>;
}
