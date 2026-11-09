import { URL } from "node:url";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {organizerRosterMetrics} from './organizer-roster-metrics.ts';
import fs from 'node:fs';

test('issued includes history, awaiting check-in excludes refunded and void credentials',()=>{
  assert.deepEqual(organizerRosterMetrics([
    {category:'admission',status:'active'}, {category:'admission',status:'transfer_pending'}, {category:'admission',status:'scanned'},
    {category:'admission',status:'active',checked_in_at:'2026-01-01T00:00:00Z'},
    {category:'admission',status:'refunded'}, {category:'admission',status:'void'},
    {category:'admission',status:'refunded',checked_in_at:'2026-01-01T00:00:00Z'},
  ]),{issued:7,checkedIn:3,awaitingCheckIn:2});
});
test('counts include all pages of a large roster without implying inventory left',()=>{
  assert.deepEqual(organizerRosterMetrics(Array.from({length:1207},()=>({category:'admission',status:'active'}))),{issued:1207,checkedIn:0,awaitingCheckIn:1207});
  assert.deepEqual(organizerRosterMetrics([]),{issued:0,checkedIn:0,awaitingCheckIn:0});
});
for(const file of ['../../features/events/organizer.web.tsx','../../features/routes/screens/(protected)/events/[id]/organizer.tsx']) test(`${file} uses shared metric definitions and explicit labels`,()=>{
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  assert.match(source,/organizerRosterMetrics\(/);
  assert.match(source,/Issued tickets/);
  assert.match(source,/Awaiting check-in/);
  assert.doesNotMatch(source,/totalCount - checkedInCount/);
});

for(const file of ['../../features/events/analytics.web.tsx','../../features/routes/screens/(protected)/events/[id]/analytics.tsx']) test(`${file} distinguishes issued history and valid attendance`,()=>{
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');assert.match(source,/Tickets issued/);assert.match(source,/tier inventory remaining/);assert.match(source,/Refunded and cancelled tickets are excluded/);
});
for(const file of ['../../features/events/host.web.tsx','../../features/routes/screens/(protected)/events/host.tsx']) test(`${file} names units, capacity and value separately`,()=>{
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');assert.match(source,/valid tickets/);assert.match(source,/Capacity/);assert.match(source,/ticket \+ add-on value/);
});


test('service/product redemption remains issued history, never admission progress',()=>{
  assert.deepEqual(organizerRosterMetrics([
    {category:'admission',status:'active'},
    {category:'admission',status:'scanned'},
    {category:'service',status:'active'},
    {category:'service',status:'scanned',checked_in_at:'2099-01-01T00:00:00Z'},
    {category:'product',status:'scanned'},
    {category:'coat_check',status:'scanned'},
    {status:'active'},
  ]),{issued:7,checkedIn:1,awaitingCheckIn:1});
});
