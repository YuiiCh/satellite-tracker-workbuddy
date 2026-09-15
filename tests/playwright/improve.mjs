import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const CHROME =
  process.env.CHROME_PATH ||
  "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";

const flags = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--no-sandbox",
  "--window-size=1600,1000",
];

const errors = [];
const browser = await chromium.launch({
  headless: false,
  executablePath: CHROME,
  args: flags,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const log = (...a) => console.log(...a);
async function shot(name) {
  try {
    await page.screenshot({ path: `/workspace/tests/playwright/${name}` });
  } catch {}
}

// 在 DOM 层点击（绕过 swiftshader 下 Playwright actionability 误判）
async function clickText(txt) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes(t),
    );
    if (!b) return false;
    b.click();
    return true;
  }, txt);
}
async function selectGroup(g) {
  return page.evaluate((grp) => {
    const s = document.querySelector("select");
    if (!s) return false;
    s.value = grp;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, g);
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// 切到单星座模式
await clickText("单星座聚类");
await page.waitForSelector("select", { state: "attached", timeout: 20000 });
log("✔ 已切到单星座模式");

// starlink：点很多，验证自适应缩小
await selectGroup("starlink");
await page.waitForSelector(".chart-box", { state: "attached", timeout: 30000 });
await page.waitForTimeout(2500);
const starlinkSize = await page
  .locator(".chart-box")
  .first()
  .getAttribute("data-symbol-size");
log("starlink 自适应点径 =", starlinkSize, "px");

// 全屏
await clickText("全屏");
await page.waitForSelector(".chart-box.fullscreen", { state: "attached", timeout: 10000 });
await page.waitForTimeout(1200);
await shot("imp-fullscreen-starlink.png");
log("✔ 全屏已激活");

// 高度图例弹窗
await clickText("高度图例");
await page.waitForSelector(".legend-popup", { state: "attached", timeout: 10000 });
const legendCount = await page.locator(".legend-popup .legend-item").count();
log("✔ 高度图例弹窗已展开，条目数 =", legendCount);
await shot("imp-legend-starlink.png");

// 退出全屏
await clickText("退出全屏");
await page.waitForTimeout(800);
const stillFull = await page.locator(".chart-box.fullscreen").count();
log(stillFull === 0 ? "✔ 已退出全屏" : "✘ 退出全屏失败");

// beidou 多壳层
await selectGroup("beidou");
await page.waitForTimeout(2500);
const beidouSize = await page
  .locator(".chart-box")
  .first()
  .getAttribute("data-symbol-size");
const shells = await page.locator(".chart-box").count();
log("beidou 自适应点径 =", beidouSize, "px，壳层数 =", shells);
await clickText("高度图例");
await page.waitForSelector(".legend-popup", { state: "attached", timeout: 10000 });
const beidouLegend = await page.locator(".legend-popup .legend-item").count();
log("beidou 高度图例条目数 =", beidouLegend);
await shot("imp-beidou-legend.png");

log("=== 控制台错误数:", errors.length, "===");
errors.slice(0, 10).forEach((e) => log("  ERR:", e));

await browser.close();
log("DONE");
