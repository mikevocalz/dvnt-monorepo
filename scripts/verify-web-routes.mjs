#!/usr/bin/env node
/**
 * verify-web-routes — every client navigation target in the web build must
 * resolve to a real Next route (or a next.config redirect/rewrite).
 *
 * Why this exists: the shared screens are ported from native, where protected
 * screens live at bare paths (`/(protected)/ticket/[id]`). On web the same
 * screens are mounted under `/feed/*`, so a copied `router.push("/ticket/x")`
 * compiles, type-checks, and 404s in production. That shipped once and broke
 * "View ticket" for every buyer — this check is the tripwire.
 *
 * Usage: node scripts/verify-web-routes.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP_DIR = path.join(ROOT, 'apps/web/src/app/(frontend)');

/** Filesystem routes, with `(group)` segments stripped. */
function collectRoutes(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const seg = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
      out.push(...collectRoutes(path.join(dir, entry.name), prefix + seg));
    } else if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
      out.push(prefix || '/');
    }
  }
  return out;
}

const routes = collectRoutes(APP_DIR);
const segRe = (s) =>
  s.startsWith('[...') || s.startsWith('[[...')
    ? '.+'
    : s.startsWith('[')
      ? '[^/]+'
      : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compiled = routes.map((r) => ({
  route: r,
  dynamic: r.includes('['),
  re: new RegExp(`^${r.split('/').map(segRe).join('/')}$`),
}));

/** Path prefixes handled by next.config redirects/rewrites, not by a page. */
const configPath = path.join(ROOT, 'apps/web/next.config.ts');
const configSrc = fs.readFileSync(configPath, 'utf8');
const configSources = [...configSrc.matchAll(/source:\s*'([^']+)'/g)]
  .map((m) => m[1])
  // `/:path*` is the host-conditional canonical redirect (dvnt-blog.vercel.app
  // -> dvntapp.live). It matches every path but provides no route, so counting
  // it here would make this check pass on anything.
  .filter((src) => src !== '/:path*')
  .map((src) =>
  new RegExp(
    `^${src
      .split('/')
      .map((s) =>
        s.startsWith(':') ? (s.endsWith('*') ? '.*' : '[^/]+') : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/')}$`,
  ),
);

/** Resolves? Static routes win over dynamic ones, same as Next. */
function resolves(p) {
  return (
    compiled.some((c) => !c.dynamic && c.re.test(p)) ||
    compiled.some((c) => c.dynamic && c.re.test(p)) ||
    configSources.some((re) => re.test(p))
  );
}

const files = execSync(
  "grep -rl --include='*.web.tsx' --include='*.web.ts' '' packages/app apps/web/src",
  { cwd: ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

const broken = [];
for (const file of files) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const rx = /(?:router\.(?:push|replace)|href=)\(?\s*(["'`])(\/[^"'`]*?)\1/g;
    let m;
    while ((m = rx.exec(line))) {
      // `${expr}` is a dynamic segment; strip query/hash and trailing slash.
      const target = m[2]
        .split(/[?#]/)[0]
        .replace(/\$\{[^}]*\}/g, 'x')
        .replace(/\/+$/, '') || '/';
      if (!resolves(target)) broken.push(`${file}:${i + 1}  ${m[2]}`);
    }
  });
}

if (broken.length) {
  console.error(`✗ ${broken.length} web navigation target(s) do not resolve:\n`);
  console.error(broken.map((b) => `  ${b}`).join('\n'));
  console.error('\nProtected screens are mounted under /feed on web. Prefix the path.');
  process.exit(1);
}
console.log(`✓ every web navigation target resolves (${routes.length} routes, ${files.length} files)`);
