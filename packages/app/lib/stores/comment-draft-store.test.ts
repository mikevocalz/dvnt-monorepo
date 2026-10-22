import test from 'node:test';
import assert from 'node:assert/strict';
import { useCommentDraftStore } from './comment-draft-store.ts';

test('context binding preserves seeded replies and is StrictMode-idempotent', () => {
  useCommentDraftStore.setState({context:null,open:false,text:'',replyTo:null,revision:0});
  const store = useCommentDraftStore.getState();
  store.setReplyTo({commentId:'17',username:'member'});
  store.setText('A reply');
  store.bindContext('post:comments');
  const revision = useCommentDraftStore.getState().revision;
  store.bindContext('post:comments');
  assert.equal(useCommentDraftStore.getState().revision, revision);
  assert.equal(useCommentDraftStore.getState().text, 'A reply');
  assert.equal(useCommentDraftStore.getState().replyTo?.commentId, '17');
});

test('a different post or thread cannot inherit the old target or draft', () => {
  const store = useCommentDraftStore.getState();
  store.bindContext('different-post:comments');
  assert.equal(useCommentDraftStore.getState().open, false);
  assert.equal(useCommentDraftStore.getState().text, '');
  assert.equal(useCommentDraftStore.getState().replyTo, null);
  store.openComposer({commentId:'18',username:'other'});
  store.setText('Thread draft');
  store.bindContext('different-post:root-thread');
  assert.equal(useCommentDraftStore.getState().text, '');
  assert.equal(useCommentDraftStore.getState().replyTo, null);
});

test('cancel reply preserves text while revision invalidates deferred submission', () => {
  const store = useCommentDraftStore.getState();
  store.openComposer({commentId:'17',username:'member'});
  store.setText('Keep this');
  const revision = useCommentDraftStore.getState().revision;
  store.setReplyTo(null);
  assert.equal(useCommentDraftStore.getState().text, 'Keep this');
  assert.equal(useCommentDraftStore.getState().open, true);
  assert(useCommentDraftStore.getState().revision > revision);
  store.reset();
  assert.equal(useCommentDraftStore.getState().open, false);
  assert.equal(useCommentDraftStore.getState().text, '');
});
