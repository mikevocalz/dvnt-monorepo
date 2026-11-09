import assert from 'node:assert/strict';
import test from 'node:test';
import {fitTextPostFontSize} from './text-post-layout.ts';
test('fits narrow cards and long text without increasing preferred size',()=>{
 assert.equal(fitTextPostFontSize('Short',320,30),30);
 assert.equal(fitTextPostFontSize('x'.repeat(1500),320,38),18);
 assert.equal(fitTextPostFontSize('x'.repeat(1500),90,38),12);
 assert.ok(fitTextPostFontSize('https://example.test/'+ 'x'.repeat(200),150,30)<30);
 assert.equal(fitTextPostFontSize('😈\n'.repeat(600),240,38),18);
 assert.equal(fitTextPostFontSize('',0,30),30);
});
