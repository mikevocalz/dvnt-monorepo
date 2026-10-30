import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageReactions, reactionsFromMetadata, setReactionPresence } from './reactions.ts';

test('reaction parsing normalizes legacy IDs and ignores malformed entries', () => {
  assert.deepEqual(parseMessageReactions([null, {}, {emoji:'❤️',userId:3}, {emoji:1,userId:'3'}]), [{emoji:'❤️',userId:'3',username:'user'}]);
});
test('partial realtime metadata does not erase reactions, explicit null/empty metadata does', () => {
  assert.equal(reactionsFromMetadata(undefined), undefined);
  assert.equal(reactionsFromMetadata('{broken'), undefined);
  assert.deepEqual(reactionsFromMetadata(null), []);
  assert.deepEqual(reactionsFromMetadata('{"reactions":[]}'), []);
});
test('desired-state updates are idempotent and preserve other participants', () => {
  const mine={emoji:'❤️',userId:'1',username:'one'}, other={...mine,userId:'2',username:'two'};
  const added=setReactionPresence([other],mine,true);
  assert.deepEqual(setReactionPresence(added,mine,true),added);
  assert.deepEqual(setReactionPresence(added,mine,false),[other]);
});
