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
// 先展开收起的侧栏
await page.waitForSelector("button.collapse-btn", { timeout: 15000 }).catch(() => {});
await page.evaluate(() => {
  const b = document.querySelector("button.collapse-btn");
  if (b) b.click();
});
await page.waitForTimeout(500);
// 切换到 Cesium
const toggled = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const t = btns.find((b) => (b.textContent || "").includes("全部卫星"));
  if (t) { t.click(); return true; }
  return false;
});
console.log("toggledToCesium =", toggled);

// 等待边界加载
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const v = window.__cesiumViewer;
  const out = { hasViewer: !!v, dataSources: [] };
  if (!v) return out;
  for (let i = 0; i < v.dataSources.length; i++) {
    const ds = v.dataSources.get(i);
    out.dataSources.push({
      name: ds.name,
      entities: ds.entities.values.length,
      isGeoJson: !!ds.clock, // not reliable
    });
  }
  // 检查 globe
  const g = v.scene.globe;
  out.globeBaseColor = g ? g.baseColor?.toCssColorString?.() : null;
  out.globeShow = g ? g.show : null;
  return out;
});
console.log("DATASOURCES:", JSON.stringify(info, null, 2));
console.log("=== CONSOLE LOGS ===");
for (const l of logs) console.log(l);
const outlineWarn = logs.filter((l) => /outline/i.test(l)).length;
console.log("outlineWarnings =", outlineWarn);

// 截图：默认俯瞰 + 缩放到大陆级以看清边界
await page.screenshot({ path: "/workspace/tests/playwright/borders_default.png" });
await page.evaluate(() => {
  const sc = window.__satScene;
  if (sc) for (let i = 0; i < 6; i++) sc.zoomIn();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: "/workspace/tests/playwright/borders_zoom.png" });

await browser.close();

