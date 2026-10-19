const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('scripts/diagnostics/browser-live-photo-intake.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const output = { textContent: '' };
const clear = { addEventListener(type, fn) { this.handler = fn; } };
const input = { dataset: { mode: 'test' }, files: [], addEventListener(type, fn) { this.handler = fn; } };
const sandbox = { TextDecoder, Uint8Array, DataView, document: {
  querySelector: selector => selector === '#output' ? output : clear,
  querySelectorAll: () => [input],
}};
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const box = (kind, payload = Buffer.alloc(0)) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + payload.length); b.write(kind, 4); return Buffer.concat([b, payload]); };
const file = (bytes, type) => ({ size: bytes.length, type, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
(async () => {
 const jpeg = Buffer.concat([Buffer.from([255,216]), Buffer.from('com.apple.quicktime.content.identifier'), Buffer.from([255,217])]);
 const still = await sandbox.inspect(file(jpeg, 'image/jpeg'), 1);
 assert.equal(still.container, 'JPEG'); assert.equal(still.appleIdentifierMarkerPresent, true); assert.equal(still.movieContainerCandidate, false);
 const movie = Buffer.concat([box('ftyp', Buffer.from('qt  ')), box('mdat', Buffer.from([1,2])), box('moov')]);
 assert.equal((await sandbox.inspect(file(movie,'video/quicktime'),2)).movieContainerCandidate,true);
 const heic = Buffer.concat([box('ftyp',Buffer.from('heic')),box('meta'),box('mdat')]);
 assert.equal((await sandbox.inspect(file(heic,'image/heic'),3)).movieContainerCandidate,false);
 const malformed = Buffer.from(movie); malformed.writeUInt32BE(0xffffffff);
 assert.equal((await sandbox.inspect(file(malformed,'video/quicktime'),4)).movieContainerCandidate,false);
 let read=false; const large=await sandbox.inspect({size:33*1024*1024,type:'image/jpeg',arrayBuffer(){read=true;}},5);
 assert.equal(read,false); assert.match(large.inspection,/Skipped/);
 const privateValue = 'PRIVATE-IDENTIFIER-DO-NOT-REPORT';
 const named = file(Buffer.concat([jpeg, Buffer.from(privateValue)]), 'image/jpeg'); named.name = 'PRIVATE-FILENAME.jpg';
 input.files = [named, file(movie, 'video/quicktime')]; await input.handler();
 const report = JSON.parse(output.textContent)[0];
 assert.equal(report.applePairVerification, 'Not performed'); assert.equal(report.selectedFileCount, 2);
 assert.ok(!output.textContent.includes(privateValue)); assert.ok(!output.textContent.includes(named.name));
 let release; input.files = [{ size: 3, type: 'image/jpeg', arrayBuffer: () => new Promise(resolve => { release = resolve; }) }];
 const pending = input.handler(); clear.handler(); release(Uint8Array.from([255,216,255]).buffer); await pending;
 assert.equal(output.textContent, 'Results cleared.');
 assert.ok(html.includes("connect-src 'none'")); assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|toDataURL|toBlob/.test(code));
 console.log('PASS: original-only bounded diagnostic, still identifiers not motion, valid container candidate, HEIC not movie, malformed lengths, size cap, no network or conversion');
})().catch(error=>{console.error(error);process.exit(1)});
