/** Render synthetic local HTML only; never sends email or fetches remote assets. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fixtures } from '../apps/mobile/supabase/functions/_shared/email/fixtures.mjs';
const out = resolve(process.argv[2] || '/tmp/dvnt-email-previews');
await mkdir(out, { recursive: true });
for (const [name, email] of Object.entries(fixtures)) {
  await writeFile(join(out, `${name}.html`), email.html);
}
console.log(`Rendered ${Object.keys(fixtures).length} synthetic email previews to ${out}; no email sent.`);
