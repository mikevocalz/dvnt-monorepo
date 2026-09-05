import { chromium } from "@playwright/test";
const R = "[V1788579497]";
const log = (...a) => console.log(R, ...a);
const M = "/private/tmp/claude-501/-Users-mikevocalz/f87dc3e1-0648-42f3-b6dc-696601ed84aa/scratchpad/media";
const b = await chromium.launch({ channel: "chrome" });
const c = await b.newContext({ storageState:"e2e/.auth/audit.json", viewport:{width:1280,height:950}, baseURL:"http://localhost:3000" });
await c.addInitScript(() => localStorage.setItem("dvnt-pwa-install-dismissed","1"));
const p = await c.newPage();
p.on("console", m => { const t=m.text(); if (/toast|Save error/i.test(t)) log(t.slice(0,120)); });
// Put the video on the newest event so it is top of the list.
await p.goto("/feed/events/76/edit", { waitUntil:"load" }).catch(()=>{});
await p.waitForTimeout(9000);
log("edit url:", p.url());
const picker = p.locator('input[type="file"]').last();
await picker.setInputFiles(M + "/clip.mp4");
await p.waitForTimeout(4000);
log("video in editor:", await p.locator("video").count());
await p.getByRole("button", { name: /^done$/i }).first().click();
await p.waitForTimeout(18000);
log("after save:", p.url());
// Now look at the events list
await p.goto("/feed/events", { waitUntil:"load" });
await p.waitForTimeout(13000);
const v = await p.evaluate(() => [...document.querySelectorAll("video")].map(el => ({
  src: (el.currentSrc||el.src||"").split("/").pop()?.slice(0,26), playing: !el.paused, ready: el.readyState, w: el.videoWidth })));
log("videos on the events list:", JSON.stringify(v));
await b.close();
