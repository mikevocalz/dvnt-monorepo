import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberSignupContinuation, hasSignupContinuation, clearSignupContinuation } from './signup-continuation.ts';

test('signup continuation is account-bound, expiring, removable and optional storage', () => {
  const previous = globalThis.window;
  const data = new Map<string,string>();
  try {
    globalThis.window = { sessionStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)} } as any;
    assert.equal(hasSignupContinuation('auth-a'),false);
    rememberSignupContinuation('auth-a');
    assert.equal(hasSignupContinuation('auth-a'),true);
    assert.equal(hasSignupContinuation('auth-b'),false);
    for (const savedAt of [Date.now()-3600001, Date.now()+60000, null]) {
      data.set('dvnt:signup:continuation',JSON.stringify({authId:'auth-a',savedAt}));
      assert.equal(hasSignupContinuation('auth-a'),false);
    }
    rememberSignupContinuation('auth-a');clearSignupContinuation();assert.equal(hasSignupContinuation('auth-a'),false);
    globalThis.window = {sessionStorage:{getItem(){throw Error('disabled')},setItem(){throw Error('disabled')},removeItem(){throw Error('disabled')}}} as any;
    assert.doesNotThrow(()=>rememberSignupContinuation('auth-a'));
    assert.equal(hasSignupContinuation('auth-a'),false);assert.doesNotThrow(clearSignupContinuation);
  } finally { if(previous===undefined)delete (globalThis as any).window;else globalThis.window=previous; }
});
