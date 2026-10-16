'use strict';

// Hoisted node_modules keep the same pathname and package version after a pnpm
// patch changes. Webpack's managed-path snapshots can therefore reuse the old
// compiled module. Check the actual installed bytes and include the patch in
// every filesystem cache version, then verify the emitted browser bundle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const PATCH = 'pnpm-patches/@moq__publish@0.5.2.patch';
const MARKERS = [
  'Video orientation normalization needs a 2D canvas',
  'Video capture needs a 2D canvas',
  'Video element has no current frame',
];

function checkInstalledPublisher(repoRoot = ROOT, importer = path.join(repoRoot, 'packages/app/package.json')) {
  const patchFile = path.join(repoRoot, PATCH);
  const patch = fs.readFileSync(patchFile, 'utf8');
  const entry = createRequire(importer).resolve('@moq/publish');
  const packageRoot = path.dirname(entry);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '0.5.2') throw new Error(`Lynk publisher changed to ${manifest.version}; revalidate its orientation patch before building`);
  if (!fs.readFileSync(entry, 'utf8').includes('./encoder-CjcsUSCu.js') ||
      !fs.readFileSync(path.join(packageRoot, 'encoder-CjcsUSCu.js'), 'utf8').includes('./video-B0t1PcDc.js')) {
    throw new Error('Lynk publisher entry no longer references the verified capture module');
  }

  // Validate every postimage hunk, including the capture call sites. Checking
  // only that the helper exists would miss a stale entry/module or unused file.
  for (const file of patch.split(/^diff --git /m).slice(1)) {
    const name = /^\+\+\+ b\/(.+)$/m.exec(file)?.[1];
    if (!name || name.includes('..') || path.isAbsolute(name)) throw new Error('Invalid Lynk publisher patch path');
    const installed = fs.readFileSync(path.join(packageRoot, name), 'utf8').replace(/\r\n/g, '\n');
    const hunks = file.split(/^@@ [^\n]+\n/m).slice(1);
    if (!hunks.length) throw new Error(`Missing patch hunk for ${name}`);
    for (const hunk of hunks) {
      const expected = hunk.split('\n').filter(line => line.startsWith('+') || line.startsWith(' ')).map(line => line.slice(1)).join('\n');
      if (!installed.includes(expected)) throw new Error(`Installed @moq/publish is missing the Lynk orientation patch in ${name}. Reinstall the locked dependency before building.`);
    }
  }
  return { patchFile, hash: crypto.createHash('sha256').update(patch).digest('hex'), packageRoot };
}

function withOrientationCache(config, state) {
  if (config.cache && config.cache.type === 'filesystem') {
    config.cache.version = `${config.cache.version || ''}|lynk-orientation:${state.hash}`;
    config.cache.buildDependencies = {
      ...config.cache.buildDependencies,
      lynkOrientation: [state.patchFile, __filename],
    };
  }
  return config;
}

function checkBrowserBundle(directory) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
  visit(directory);
  const publisherChunks = files.map(file => ({ file, source: fs.readFileSync(file, 'utf8') }))
    .filter(item => item.source.includes('Using MediaStreamTrackProcessor polyfill; performance might suffer.'));
  if (!publisherChunks.length) throw new Error('No Lynk publisher browser chunk found; cannot verify orientation correction');
  for (const { file, source } of publisherChunks) {
    for (const marker of MARKERS) if (!source.includes(marker)) {
      throw new Error(`Browser bundle is missing Lynk orientation correction (${marker}) in ${path.basename(file)}. A stale or unpatched SDK must not ship.`);
    }
  }
  return publisherChunks.map(item => item.file);
}

module.exports = { checkInstalledPublisher, withOrientationCache, checkBrowserBundle };
if (require.main === module) {
  const state = checkInstalledPublisher();
  if (process.argv.includes('--bundle')) {
    const chunks = checkBrowserBundle(path.join(ROOT, 'apps/web/.next/static/chunks'));
    console.log(`[lynk-orientation] Verified ${chunks.length} emitted publisher chunk(s), patch ${state.hash.slice(0, 12)}`);
  } else console.log(`[lynk-orientation] Verified installed publisher, patch ${state.hash.slice(0, 12)}`);
}
