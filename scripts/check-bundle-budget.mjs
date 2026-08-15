#!/usr/bin/env node
/**
 * First Load JS budget guard for apps/web.
 *
 * Next 16 dropped the size columns from the build-output route table, and
 * `next experimental-analyze --output` writes RSC payloads and a route-name
 * list with no sizes. So per-route First Load JS is measured here the only way
 * that survives: the `/_next/static/chunks/*.js` a prerendered route actually
 * references, summed from disk.
 *
 *   node scripts/check-bundle-budget.mjs            # check budgets, exit 1 over
 *   node scripts/check-bundle-budget.mjs --report   # print every route
 *   node scripts/check-bundle-budget.mjs --attribute
 *
 * --attribute decodes source-map mappings to attribute SHIPPED bytes per npm
 * package. It needs maps, so build with ANALYZE_SOURCEMAPS=1 first. Do NOT
 * attribute by `sourcesContent` length: that is pre-minification source, it is
 * mostly comments for generated files, and it ranks packages wrongly.
 *
 * Budgets are uncompressed bytes, set ~10% above the 2026-08-15 baseline
 * recorded in docs/perf/bundle-size-baseline.md. Raise them deliberately, with
 * a number and a reason, never to make a red build green.
 */
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.join(process.cwd(), 'apps/web');
const APP_DIR = path.join(WEB, '.next/server/app');
const CHUNK_DIR = path.join(WEB, '.next/static/chunks');

const BUDGET_KB = {
  // Worst route. /feed was 2,644 KB at baseline.
  maxRoute: 2900,
  // Chunks common to every public route — what a first-time visitor always pays.
  // 2,029 KB at baseline.
  shared: 2235,
};

// Routes used to compute the shared set. Public, always-reachable, and not
// behind auth, so the intersection is what any visitor loads.
const SHARED_PROBE = ['index', 'feed', 'events', 'pricing', 'faq'];

const KB = (b) => b / 1024;
const fmt = (b) => KB(b).toFixed(0).padStart(6);

function chunksFor(htmlFile) {
  const html = fs.readFileSync(path.join(APP_DIR, htmlFile), 'utf8');
  return [
    ...new Set(
      [...html.matchAll(/\/_next\/static\/chunks\/([^"?]+\.js)/g)].map((m) => m[1]),
    ),
  ];
}

function sizeOf(chunks) {
  let bytes = 0;
  let missing = 0;
  for (const c of chunks) {
    try {
      bytes += fs.statSync(path.join(CHUNK_DIR, c)).size;
    } catch {
      missing += 1;
    }
  }
  return { bytes, missing };
}

function routes() {
  if (!fs.existsSync(APP_DIR)) {
    console.error(`No build found at ${APP_DIR}. Run \`pnpm build\` in apps/web first.`);
    process.exit(2);
  }
  return fs.readdirSync(APP_DIR).filter((f) => f.endsWith('.html'));
}

function measure() {
  const rows = routes().map((h) => {
    const chunks = chunksFor(h);
    const { bytes, missing } = sizeOf(chunks);
    return { route: h.replace(/\.html$/, '') || '/', chunks: chunks.length, bytes, missing };
  });
  rows.sort((a, b) => b.bytes - a.bytes);

  const probe = SHARED_PROBE.filter((r) => fs.existsSync(path.join(APP_DIR, `${r}.html`)));
  let shared = { bytes: 0, count: 0 };
  if (probe.length >= 2) {
    const sets = probe.map((r) => new Set(chunksFor(`${r}.html`)));
    const common = [...sets[0]].filter((c) => sets.every((s) => s.has(c)));
    shared = { bytes: sizeOf(common).bytes, count: common.length };
  }
  return { rows, shared, probe };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const { rows, shared, probe } = measure();

  if (args.has('--attribute')) return attribute(probe);

  if (args.has('--report')) {
    console.log('First Load JS per route (uncompressed)\n');
    console.log('    KB  chunks  route');
    for (const r of rows) console.log(`${fmt(r.bytes)}  ${String(r.chunks).padStart(6)}  ${r.route}`);
    console.log();
  }

  const worst = rows[0];
  const checks = [
    ['worst route', worst.bytes, BUDGET_KB.maxRoute * 1024, `/${worst.route}`],
    ['shared payload', shared.bytes, BUDGET_KB.shared * 1024, `${shared.count} chunks`],
  ];

  let failed = false;
  for (const [label, actual, budget, detail] of checks) {
    const over = actual > budget;
    failed ||= over;
    console.log(
      `${over ? 'FAIL' : 'ok  '}  ${label.padEnd(15)} ${KB(actual).toFixed(0).padStart(6)} KB ` +
        `/ ${KB(budget).toFixed(0)} KB budget  (${detail})`,
    );
  }

  if (failed) {
    console.error(
      '\nFirst Load JS is over budget. Find out what grew:\n' +
        '  ANALYZE_SOURCEMAPS=1 pnpm --filter web build\n' +
        '  node scripts/check-bundle-budget.mjs --attribute',
    );
    process.exit(1);
  }
}

// --- shipped-byte attribution via source-map mappings -----------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVLQ(str, i, out) {
  let result = 0;
  let shift = 0;
  let cont;
  do {
    const c = B64.indexOf(str[i++]);
    if (c < 0) throw new Error(`bad VLQ char at ${i - 1}`);
    cont = c & 32;
    result += (c & 31) << shift;
    shift += 5;
  } while (cont);
  const negative = result & 1;
  result >>= 1;
  out.push(negative ? (result === 0 ? -0x80000000 : -result) : result);
  return i;
}

/**
 * Bytes of generated (minified) output attributable to each source file.
 * A segment owns the span from its generated column to the next segment's.
 */
function shippedBytesPerSource(jsPath, mapPath) {
  const lines = fs.readFileSync(jsPath, 'utf8').split('\n');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const per = new Map();
  let srcIdx = 0;

  map.mappings.split(';').forEach((group, gl) => {
    if (!group) return;
    const lineLen = lines[gl]?.length ?? 0;
    const segs = [];
    let genCol = 0;
    for (const seg of group.split(',')) {
      if (!seg) continue;
      const fields = [];
      let i = 0;
      while (i < seg.length) i = decodeVLQ(seg, i, fields);
      genCol += fields[0];
      if (fields.length >= 4) srcIdx += fields[1];
      segs.push({ col: genCol, src: fields.length >= 4 ? srcIdx : -1 });
    }
    segs.forEach((s, i) => {
      if (s.src < 0) return;
      const end = i + 1 < segs.length ? segs[i + 1].col : lineLen;
      const span = Math.max(0, end - s.col);
      const name = map.sources[s.src];
      per.set(name, (per.get(name) || 0) + span);
    });
  });
  return per;
}

function bucket(source) {
  const k = source.replace(/^webpack:\/\/_N_E\//, '');
  const npm = k.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (npm) return npm[1];
  const ws = k.match(/(packages\/[^/]+|apps\/[^/]+)/);
  if (ws) return `workspace: ${ws[1]}`;
  // Next ships its own sources with relative paths that carry no package name.
  if (/src\/(client|shared|server)\//.test(k)) return 'next (internals)';
  return `unresolved: ${k}`;
}

function attribute(probe) {
  const sets = probe.map((r) => new Set(chunksFor(`${r}.html`)));
  const shared = [...sets[0]].filter((c) => sets.every((s) => s.has(c)));

  const by = new Map();
  let attributed = 0;
  let mapless = 0;
  for (const c of shared) {
    const js = path.join(CHUNK_DIR, c);
    const mp = `${js}.map`;
    if (!fs.existsSync(mp)) {
      mapless += 1;
      continue;
    }
    for (const [src, bytes] of shippedBytesPerSource(js, mp)) {
      attributed += bytes;
      const b = bucket(src);
      by.set(b, (by.get(b) || 0) + bytes);
    }
  }

  if (!attributed) {
    console.error(
      'No source maps found. Rebuild with:\n  ANALYZE_SOURCEMAPS=1 pnpm --filter web build',
    );
    process.exit(2);
  }

  console.log(`shared payload attributed: ${KB(attributed).toFixed(0)} KB shipped`);
  if (mapless) console.log(`(${mapless} shared chunks had no map and are excluded)`);
  console.log('\nshare   shipped KB  package');
  for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`${((v * 100) / attributed).toFixed(1).padStart(5)}% ${KB(v).toFixed(1).padStart(11)}  ${k}`);
  }
}

main();
