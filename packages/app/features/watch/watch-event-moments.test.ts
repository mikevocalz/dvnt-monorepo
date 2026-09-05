import test from "node:test";
import assert from "node:assert/strict";
import { projectWatchMoments, type EventMomentRow } from "./watch-event-moments";
const now = Date.parse("2026-09-05T12:00:00Z");
const row: EventMomentRow = {id:1,user_id:7,media_type:"photo",media_url:"https://dvnt.b-cdn.net/moment.jpg",is_flagged:false,expires_at:"2026-09-06T12:00:00Z"};
test("only six permitted photos, bounded rendition and offline permission lease",()=>{
 const results = projectWatchMoments(Array.from({length:10},(_,i)=>({...row,id:i+1})),new Set(),now);
 assert.equal(results.length,6); assert.match(results[0].imageURL,/width=320/);
 assert.equal(results[0].visibleUntil,"2026-09-05T12:05:00.000Z");
});
test("blocks, flags, video, expiry and malformed or credentialed URLs fail closed",()=>{
 const variants = [{...row,user_id:8},{...row,is_flagged:true},{...row,media_type:"video"},{...row,expires_at:"2026-09-05T11:00:00Z"},{...row,media_url:"http://cdn.example.com/photo.jpg"},{...row,media_url:"https://user:secret@cdn.example.com/photo.jpg"},{...row,media_url:"https://cdn.example.com/video.mp4"}];
 assert.deepEqual(projectWatchMoments(variants,new Set(["8"]),now),[]);
});
test("expiry earlier than offline lease wins and duplicate photos are removed",()=>{
 const photo={...row,expires_at:"2026-09-05T12:01:00Z"};
 const result=projectWatchMoments([photo,photo],new Set(),now);
 assert.equal(result.length,1);assert.equal(result[0].visibleUntil,"2026-09-05T12:01:00.000Z");
});
