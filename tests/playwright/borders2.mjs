import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const exe = "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";

const browser = await chromium.launch({
  executablePath: exe,
  headless: false,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
// 展开收起侧栏
await page.waitForSelector("button.collapse-btn", { timeout: 15000 });
await page.evaluate(() => document.querySelector("button.collapse-btn")?.click());
await page.waitForTimeout(400);
// 切到 Cesium
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    (x.textContent || "").includes("全部卫星"),
  );
  b?.click();
});
await page.waitForTimeout(1500);
// 反选 → 取消所有星座（0 颗卫星绘制）
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => (x.textContent || "").trim() === "反选",
  );
  b?.click();
});
await page.waitForTimeout(5000); // 等待边界 GeoJSON 加载

// 断言 1：已绘制 0 颗（无卫星）
const drawnTxt = await page.evaluate(() => document.body.innerText);
const drawn0 = /已绘制\s*0\s*颗/.test(drawnTxt);
console.log("drawnZero =", drawn0);

// 断言 2：边界折线集合已加载
const borderInfo = await page.evaluate(() => {
  const v = window.__cesiumViewer;
  const p = window.__cesiumBorders;
  return {
    hasBorders: !!p,
    borderCount: p ? p.length : 0,
    primInScene: v ? v.scene.primitives.length : -1,
  };
});
console.log("borderInfo =", JSON.stringify(borderInfo));

// 截图：全局 + 放大
await page.screenshot({ path: "/workspace/tests/playwright/b2_default.png" });
await page.evaluate(() => {
  const sc = window.__satScene;
  if (sc) for (let i = 0; i < 6; i++) sc.zoomIn();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: "/workspace/tests/playwright/b2_zoom.png" });

console.log("=== CONSOLE ===");
for (const l of logs) console.log(l);

await browser.close();

if (!drawn0) console.log("WARN: 并非 0 颗卫星");
if (!(borderInfo.hasBorders && borderInfo.borderCount > 0))
  console.log("FAIL: 边界折线未加载");
