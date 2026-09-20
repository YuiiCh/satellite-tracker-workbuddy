import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

const EXEC = process.env.PW_CHROME || "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const browser = await chromium.launch({
  headless: false,
  executablePath: EXEC,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE_ERR: " + m.text());
});
page.on("pageerror", (e) => errors.push("PAGE_ERR: " + e.message));

console.log("goto", BASE_URL);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);

// 展开侧栏
await page.evaluate(() => {
  const b = document.querySelector(".collapse-btn");
  if (b) b.click();
});
await page.waitForTimeout(500);

// 切到 Cesium
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".seg button")];
  const t = btns.find((b) => b.textContent.includes("Cesium"));
  if (t) t.click();
});
await page.waitForTimeout(800);

// 反选 -> 0 群，再勾选 gps-ops（小群，加速软件渲染）
await page.evaluate(() => {
  const invert = [...document.querySelectorAll(".filter-actions button")].find(
    (b) => b.textContent.includes("反选"),
  );
  if (invert) invert.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".chk-list .chk")];
  const lb = labels.find((l) => l.textContent.includes("gps-ops"));
  if (lb) {
    const cb = lb.querySelector("input");
    if (cb && !cb.checked) cb.click();
  }
});
console.log("selected gps-ops, waiting for cesium...");

// 等待 viewer + 实体
await page.waitForFunction(() => window.__cesiumViewer && window.__cesiumViewer.entities.values.length > 0, null, { timeout: 25000 }).catch(() => console.log("WARN: entities not ready in time"));
await page.waitForTimeout(1500);

// 轮询 15 秒：时钟、实体数、首点位置是否有效、是否仍在视野内
// 不用 Cesium 全局，直接读 JulianDate 的 dayNumber/secondsOfDay 做相对计算
function jdSeconds(j) {
  return j.dayNumber * 86400 + j.secondsOfDay;
}
for (let i = 0; i < 15; i++) {
  const snap = await page.evaluate(() => {
    const v = window.__cesiumViewer;
    if (!v) return { err: "no viewer" };
    const clk = v.clock;
    const now = clk.currentTime;
    const start = clk.startTime;
    const stop = clk.stopTime;
    const ents = v.entities.values;
    let firstPosValid = false;
    let anyPos = null;
    if (ents.length) {
      const p = ents[0].position;
      if (p && p.getValue) {
        const c = p.getValue(now);
        firstPosValid = !!c;
        if (c) anyPos = [Math.round(c.x), Math.round(c.y), Math.round(c.z)];
      }
    }
    const s0 = now.dayNumber * 86400 + now.secondsOfDay;
    const sStart = start.dayNumber * 86400 + start.secondsOfDay;
    const sStop = stop.dayNumber * 86400 + stop.secondsOfDay;
    return {
      elapsedFromStart: Math.round(s0 - sStart),
      windowSec: Math.round(sStop - sStart),
      mult: clk.multiplier,
      range: clk.clockRange,
      nEnt: ents.length,
      firstPosValid,
      anyPos,
      sceneMode: v.scene.mode,
    };
  });
  console.log(`[${i}s]`, JSON.stringify(snap));
  await page.waitForTimeout(1000);
}

console.log("=== console/page errors ===");
console.log(errors.length ? errors.join("\n") : "none");

await browser.close();
