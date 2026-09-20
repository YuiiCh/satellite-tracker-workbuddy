import { chromium } from "playwright";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const EXEC = process.env.PW_CHROME || "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on("console", (m) => { if (m.type()==="error") errors.push("ERR: "+m.text()); });
page.on("pageerror", (e) => errors.push("PAGE_ERR: "+e.message));

await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector(".collapse-btn")?.click());
await page.waitForTimeout(300);
// 默认即为全量（所有星座群已勾选），直接切到 Cesium
await page.evaluate(() => [...document.querySelectorAll(".seg button")].find((b)=>b.textContent.includes("Cesium"))?.click());

// 等待 Worker 计算 + 点位集合就绪（全量约 1.2 万颗，给足时间）
await page.waitForFunction(() => window.__cesiumPoints && window.__cesiumPoints.length > 1000, null, { timeout: 120000 }).catch(()=>console.log("WARN: 点位未在 120s 内达到 1000"));
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const pts = window.__cesiumPoints;
  const scene = window.__satScene;
  const r = scene ? scene.getReadout() : null;
  return {
    drawn: pts ? pts.length : 0,
    pixelSize: pts ? pts.get(0).pixelSize : null,
    groups: r ? r.groups.length : 0,
    orbitLines: r ? r.orbitLines : null,
    building: r ? r.building : null,
  };
});
console.log("ALL-GROUPS:", JSON.stringify(info));
if (info.drawn < 1000) { console.error("FAIL: 全量点位过少"); process.exitCode = 1; }
if (info.pixelSize !== 2) { console.error("FAIL: 像素点非 2"); process.exitCode = 1; }
// 卫星过多时应自动关闭轨道线（上限 3000）
if (info.drawn > 3000 && info.orbitLines) console.log("NOTE: 轨道线仍开启（N>3000）");

await page.screenshot({ path: "/workspace/tests/playwright/imp5-allgroups.png" });
console.log("screenshot saved");
console.log("errors:", errors.length ? errors.join("\n") : "none");
if (errors.length) process.exitCode = 1;
await browser.close();
console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
