import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHandoffDraft, restoreHandoffDraft, addHandoffAssets, draftFingerprint, type HandoffDraft } from './live-photo-handoff-draft.ts';
const draft = (): HandoffDraft => ({ selectedMedia: [{id:'existing',uri:'blob:still',originalUri:'blob:still',type:'image',kind:'image'}],caption:'Keep my caption',textSlides:[{id:'slide',content:'hello'}],activeTextSlideIndex:0,location:'Bronx',locationData:{name:'Bronx'},taggedPeople:['person'],tags:['tag'],placedTags:[{x:0.2}],isNSFW:true,postKind:'media',textTheme:'graphite',step:'edit' });
const assets = [{photoId:1,motionId:2,url:'https://cdn.example/photo.jpg',livePhotoVideoUrl:'https://cdn.example/photo.mov',mimeType:'image/jpeg'}];
test('captures original bytes once, restores whole draft in order with fresh blob URL', async () => {
  let reads=0; const input=draft();
  const saved=await captureHandoffDraft('owner',input,async()=>{reads++;return new Blob(['original']);});
  input.caption='newer';
  assert.equal(reads,1); assert.equal(saved.draft.caption,'Keep my caption');
  const restored=restoreHandoffDraft(saved,'owner',()=> 'blob:restored');
  assert.equal(restored.selectedMedia[0].uri,'blob:restored');
  assert.equal(restored.selectedMedia[0].originalUri,'blob:restored');
  assert.deepEqual(restored.placedTags,[{x:0.2}]); assert.equal(restored.isNSFW,true);
});
test('unreadable local media fails before handoff can open; another owner cannot restore', async () => {
  await assert.rejects(captureHandoffDraft('owner',draft(),async()=>{throw Error('gone');}),/gone/);
  const saved=await captureHandoffDraft('owner',draft(),async()=>new Blob(['x']));
  assert.throws(()=>restoreHandoffDraft(saved,'other'),/account/);
  delete saved.blobs['blob:still']; assert.throws(()=>restoreHandoffDraft(saved,'owner'),/unavailable/);
});
test('append complete pairs once, preserve original order and bind already-uploaded assets to owner',()=>{
  const first=addHandoffAssets(draft(),assets,'owner','handoff');
  const retried=addHandoffAssets(first,assets,'owner','handoff');
  assert.equal(retried.selectedMedia.length,2);
  assert.equal(retried.selectedMedia[0].id,'existing');
  assert.equal(retried.selectedMedia[1].kind,'livePhoto');
  assert.equal(retried.selectedMedia[1].handoffUpload?.ownerId,'owner');
  assert.equal(retried.selectedMedia[1].pairedVideoUri,assets[0].livePhotoVideoUrl);
});
test('reject empty, incomplete and over-cap results without mutating original',()=>{
  const input=draft();const before=draftFingerprint(input);
  assert.throws(()=>addHandoffAssets(input,[],'owner','h'),/complete/);
  assert.throws(()=>addHandoffAssets(input,[{...assets[0],livePhotoVideoUrl:''}],'owner','h'),/Incomplete/);
  assert.throws(()=>addHandoffAssets({...input,selectedMedia:Array.from({length:10},(_,i)=>({...input.selectedMedia[0],id:String(i)}))},assets,'owner','h'),/at most/);
  assert.equal(draftFingerprint(input),before);
});
test('fingerprint changes for newer draft edits including motion and tags',()=>{
  const a=draft(),b=draft();assert.equal(draftFingerprint(a),draftFingerprint(b));
  b.tags.push('new'); assert.notEqual(draftFingerprint(a),draftFingerprint(b));
});
