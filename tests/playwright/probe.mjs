import { chromium } from "playwright";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const EXEC = process.env.PW_CHROME || "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("PAGE_ERR", e.message));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector(".collapse-btn")?.click());
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll(".seg button")].find((b)=>b.textContent.includes("Cesium"))?.click());
await page.waitForTimeout(700);
await page.evaluate(() => [...document.querySelectorAll(".filter-actions button")].find((b)=>b.textContent.includes("反选"))?.click());
await page.waitForTimeout(300);
await page.evaluate(() => { const lb=[...document.querySelectorAll(".chk-list .chk")].find((l)=>l.textContent.includes("gps-ops")); const cb=lb?.querySelector("input"); if(cb&&!cb.checked) cb.click(); });
await page.waitForFunction(() => window.__cesiumPoints && window.__cesiumPoints.length>0, null, {timeout:30000}).catch(()=>{});
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const v = window.__cesiumViewer;
  const c = v.clock;
  const sOf = (j) => j.dayNumber * 86400 + j.secondsOfDay;
  const before = sOf(c.currentTime);
  // 手动把 currentTime 推后 1 秒
  const t = Cesium.JulianDate.addSeconds(c.currentTime, 1, new Cesium.JulianDate());
  c.currentTime = t;
  const afterSet = sOf(c.currentTime);
  // 读取点位位置
  const p = window.__cesiumPoints.get(0).position;
  return {
    tickCalls: window.__tickCalls ?? "undef",
    shouldAnimate: c.shouldAnimate,
    multiplier: c.multiplier,
    elapsed: Math.round(sOf(c.currentTime) - sOf(c.startTime)),
    before, afterSet, diff: afterSet - before,
    posMag: Math.round(Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z)),
  };
});
console.log("PROBE:", JSON.stringify(r, null, 2));
await browser.close();
