// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const log = [];
page.on("pageerror", (e) => log.push(`!! ${e}`));
page.on("requestfinished", async (r) => {
  const p = new URL(r.url()).pathname;
  if (p.includes("/documents/")) log.push(`${p} → ${(await r.response())?.status()}`);
});
await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });

const input = page.locator("input[placeholder]");
await input.fill("I want to renew my driving license");
await input.press("Enter");

const answers = ["renewal for three years", "I'll pay by card"];
let sawPreparing = false, tapNeeded = false, ai = 0;
for (let i = 0; i < 150; i++) {
  const body = await page.locator("body").innerText();
  if (/Preparing the document/i.test(body)) sawPreparing = true;
  if (/Upload PDF/i.test(body)) { tapNeeded = true; break; }
  if (/PSK-\d{4}-\d+/.test(body)) { log.push("[reached receipt]"); break; }
  // Answer any pending question in words, the way a voice turn would.
  if (/You can say|how many years|How would you like to pay|renewal or a replacement/i.test(body)
      && !/Working on it/i.test(body) && ai < answers.length) {
    await input.fill(answers[ai++]); await input.press("Enter");
    await page.waitForTimeout(1500); continue;
  }
  await page.waitForTimeout(1000);
}
console.log(log.join("\n") || "(no /documents/ requests seen)");
console.log(`\nsaw "Preparing the document…": ${sawPreparing}`);
console.log(`needed an Upload PDF tap:      ${tapNeeded}`);
const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
console.log("\nfinal:", t.slice(-300));
await browser.close();
