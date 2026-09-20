import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const EXEC =
  process.env.PW_CHROME ||
  "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";

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

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};

console.log("goto", BASE_URL);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);

// 展开侧栏
await page.evaluate(() => document.querySelector(".collapse-btn")?.click());
await page.waitForTimeout(400);

// 切到 Cesium
await page.evaluate(() => {
  const t = [...document.querySelectorAll(".seg button")].find((b) =>
    b.textContent.includes("Cesium"),
  );
  t?.click();
});
await page.waitForTimeout(800);

// 反选 -> 0，再勾选 gps-ops（小群，加速软件渲染）
await page.evaluate(() => {
  [...document.querySelectorAll(".filter-actions button")]
    .find((b) => b.textContent.includes("反选"))
    ?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const lb = [...document.querySelectorAll(".chk-list .chk")].find((l) =>
    l.textContent.includes("gps-ops"),
  );
  const cb = lb?.querySelector("input");
  if (cb && !cb.checked) cb.click();
});

// 等待点位集合就绪
await page
  .waitForFunction(
    () => window.__cesiumPoints && window.__cesiumPoints.length > 0,
    null,
    { timeout: 30000 },
  )
  .catch(() => fail("点位集合未在 30s 内就绪"));

// 1) 像素点大小应为 2（更小）
const pixelSize = await page.evaluate(
  () => window.__cesiumPoints?.get(0)?.pixelSize,
);
console.log("pixelSize =", pixelSize);
if (pixelSize !== 2) fail(`像素点大小应为 2，实际 ${pixelSize}`);

// 2) 默认 Cesium 控件应被移除（动画/时间轴等默认 widget 容器不存在），自定义 UI 替代
const hasDefaultWidgets = await page.evaluate(
  () =>
    !!document.querySelector(".cesium-viewer-animationContainer") ||
    !!document.querySelector(".cesium-viewer-timelineContainer") ||
    !!document.querySelector(".cesium-viewer-geocoder"),
);
console.log("defaultWidgetsPresent =", hasDefaultWidgets);
if (hasDefaultWidgets) fail("仍存在 Cesium 默认控件（动画/时间轴/搜索，应已禁用）");
const hasCustomToolbar = await page.evaluate(
  () => document.querySelectorAll(".overlay .toolbar button").length,
);
console.log("customToolbarButtons =", hasCustomToolbar);
if (hasCustomToolbar !== 3) fail("自定义工具栏按钮数应为 3");

// 3) 图例与读数
const legend = await page.evaluate(() => {
  const list = [...document.querySelectorAll(".legend .lg .nm")].map(
    (e) => e.textContent,
  );
  const utc = document.querySelector(".legend .utc")?.textContent || "";
  return { list, utc };
});
console.log("legend groups =", JSON.stringify(legend.list), "utc =", legend.utc);
if (!legend.list.includes("gps-ops")) fail("图例未包含 gps-ops");
if (!legend.utc.includes("UTC")) fail("UTC 读数未显示");

// 4) 长时观测 20s：点位持续存活、非冻结、无消失
function mag(c) {
  return Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
}
let aliveAll = true;
let moved = false;
let firstPos = null;
for (let i = 0; i < 10; i++) {
  const snap = await page.evaluate(() => {
    const pts = window.__cesiumPoints;
    const v = window.__cesiumViewer;
    const p0 = pts.get(0).position;
    const clk = v.clock;
    const drawn = pts.length;
    const start = clk.startTime;
    const stop = clk.stopTime;
    const s0 = clk.currentTime.dayNumber * 86400 + clk.currentTime.secondsOfDay;
    const sS = start.dayNumber * 86400 + start.secondsOfDay;
    const sE = stop.dayNumber * 86400 + stop.secondsOfDay;
    return {
      drawn,
      p0: { x: p0.x, y: p0.y, z: p0.z },
      elapsed: Math.round(s0 - sS),
      windowSec: Math.round(sE - sS),
    };
  });
  const m = mag(snap.p0);
  const inRange = m > 6.0e6 && m < 5.0e7; // 地球半径 ~6.7e6 ~ GEO 4.2e7
  const finite = Number.isFinite(m) && m > 0;
  if (!finite || !inRange || snap.drawn <= 0) aliveAll = false;
  if (firstPos) {
    const dm = Math.abs(mag(snap.p0) - mag(firstPos));
    if (dm > 1) moved = true;
  } else firstPos = snap.p0;
  console.log(
    `[${i * 2}s] drawn=${snap.drawn} elapsed=${snap.elapsed}/${snap.windowSec}s mag=${Math.round(m)} ok=${finite && inRange && snap.drawn > 0}`,
  );
  await page.waitForTimeout(2000);
}
if (!aliveAll) fail("观测期间出现点位消失/越界/NaN");
if (!moved) fail("点位未随时钟移动（可能冻结）");

// 5) 复现“重选即出现”：切到星座视图再切回 Cesium，仍应正常绘制
await page.evaluate(() => {
  const t = [...document.querySelectorAll(".seg button")].find((b) =>
    b.textContent.includes("星座轨道分析"),
  );
  t?.click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const t = [...document.querySelectorAll(".seg button")].find((b) =>
    b.textContent.includes("Cesium"),
  );
  t?.click();
});
await page.waitForTimeout(2500);
const afterReselect = await page.evaluate(() => window.__cesiumPoints?.length);
console.log("after reselect drawn =", afterReselect);
if (!afterReselect || afterReselect <= 0) fail("重选 Cesium 后未重新绘制");

console.log("=== console/page errors ===");
console.log(errors.length ? errors.join("\n") : "none");
if (errors.length) fail("存在控制台/页面错误");

await browser.close();
console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
