import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { EVENT_FLYER_ASPECT, EVENT_FLYER_GUIDANCE } from './flyer-layout.ts';
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
test('flyer portrait canvas is TikTok-style 9:16 with existing duration limit', () => {
  assert.equal(EVENT_FLYER_ASPECT, 9 / 16);
  assert.match(EVENT_FLYER_GUIDANCE, /9:16 portrait/);
  assert.match(EVENT_FLYER_GUIDANCE, /60 sec/);
});
test('web and native create/edit share portrait guidance and geometry', () => {
  for (const path of [
    '../../features/events/event-create.web.tsx',
    '../../features/events/event-edit.web.tsx',
    '../../features/routes/screens/(protected)/events/create.tsx',
    '../../features/routes/screens/(protected)/events/[id]/edit.tsx',
  ]) {
    const s = source(path);
    assert.match(s, /aspectRatio: EVENT_FLYER_ASPECT/, path);
    assert.match(s, /\{EVENT_FLYER_GUIDANCE\}/, path);
    assert.doesNotMatch(s, /3:5 portrait|aspectRatio: (?:"3 \/ 5"|3 \/ 5)/, path);
  }
});
test('text-post surface shows user text without the unsolicited community tagline', () => {
  const s = source('../../features/post/ui/TextPostSurface.tsx');
  assert.doesNotMatch(s, /Let.s connect, share and build community/);
  assert.match(s, /text=\{displayText\}/);
  assert.match(s, /TextPostBadgeLogo/);
});
test('web full flyer and detail video preserve portrait artwork without cover cropping', () => {
  assert.match(source('../../components/event/EventFlyer.web.tsx'), /aspect = EVENT_FLYER_ASPECT/);
  const flyer = source('../../components/event/EventFlyer.web.tsx');
  assert.match(flyer, /contentFit = "contain"/);
  assert.equal((flyer.match(/objectFit: contentFit/g) || []).length, 2);
  assert.match(source('../../features/events/event-detail.web.tsx'), /aspectRatio: EVENT_FLYER_ASPECT/);
});
