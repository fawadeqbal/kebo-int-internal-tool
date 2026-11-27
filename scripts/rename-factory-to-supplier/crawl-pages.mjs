// The words of every kind of page, to compare two builds: follows links from the menu, at most N records per kind of page.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const BASE = "http://localhost:8080", out = process.argv[2], PER = Number(process.argv[3] ?? 2), MAX = Number(process.argv[4] ?? 600);
const mapAddr = process.argv[5] ? JSON.parse(fs.readFileSync(process.argv[5], "utf8")) : null; // old address pattern -> new, for a later build
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + "/login"); await page.locator("#email").fill("admin@example.com"); await page.locator("#password").fill("Admin@12345"); await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/dashboard/);
const pattern = (u) => u.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/([?&](?:id|line|doc|file|q|from|to|p|month|inquiry|order|customer|supplier|factoryId|supplierId|factory)=)[^&]*/g, "$1*");
const words = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ").replace(/\b\d+ (seconds?|minutes?|hours?) ago\b/g, "").replace(/\bjust now\b/g, "").replace(/\b\d{1,2}:\d{2}\b/g, "").trim();
const queue = ["/dashboard"], seen = new Set(queue), perPattern = {}, snap = {};
const skip = /^\/(logout|api|files\/|pdf\/|print\/|export|platform)|\.(pdf|xlsx|csv|png|jpg)(\?|$)|[?&](download|sort|dir|page|pageSize)=/;
while (queue.length && Object.keys(snap).length < MAX) {
  const u = queue.shift();
  let res;
  try { res = await page.goto(BASE + u, { timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 60000 }); } catch (e) { snap[u] = "no answer: " + String(e.message).split("\n")[0]; continue; }
  const here = page.url().replace(BASE, "");
  snap[u] = res && res.status() >= 400 ? `status ${res.status()}` : `${pattern(here)} :: ${await words()}`;
  const links = [...new Set(await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))))].filter((h) => h && h.startsWith("/") && !h.startsWith("//")).map((h) => h.split("#")[0]).filter((h) => h && !skip.test(h)).sort();
  for (const h of links) {
    if (seen.has(h)) continue;
    const p = pattern(h);
    perPattern[p] = perPattern[p] || 0;
    if (perPattern[p] >= PER) continue;
    perPattern[p]++; seen.add(h); queue.push(h);
  }
}
fs.writeFileSync(out, JSON.stringify(snap, null, 1));
console.log(out, "pages", Object.keys(snap).length, "kinds", Object.keys(perPattern).length, "left in queue", queue.length, "errors", Object.values(snap).filter((v) => /^(status|no answer)/.test(v)).length);
await browser.close();
