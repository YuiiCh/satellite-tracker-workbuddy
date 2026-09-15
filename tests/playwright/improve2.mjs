import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const CHROME = process.env.CHROME_PATH ||
  "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const OUT = "/workspace/tests/playwright";
const errors = [];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等待某个条件（用 page.evaluate 轮询，绕开 swiftshader 下 Playwright 的可见性判定卡死）
async function waitFor(page, fn, timeout = 20000, desc = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await page.evaluate(fn)) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error("等待超时: " + desc);
}
// 直接触发 DOM 点击（绕过 actionability 判定）
async function click(page, sel, nth = 0) {
  await page.evaluate(
    ({ sel, nth }) => {
      const el = document.querySelectorAll(sel)[nth];
      if (!el) throw new Error("未找到元素: " + sel + " #" + nth);
      el.click();
    },
    { sel, nth },
  );
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
  log("📸", name);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitFor(page, () => !!document.querySelector(".panel"), 20000, ".panel 出现");

  // 1) 默认进入“星座轨道分析（聚类）”视图
  const head = await page.$eval(".content-head", (e) => e.textContent);
  log("① 默认 content-head:", head.trim());
  if (!head.includes("星座轨道分析")) throw new Error("默认未进入星座轨道分析聚类视图");

  // 2) 默认侧栏收起
  const collapsedDefault = await page.evaluate(
    () => !!document.querySelector(".panel.collapsed"),
  );
  log("② 默认侧栏收起 =", collapsedDefault);
  if (!collapsedDefault) throw new Error("默认侧栏未收起");
  await shot(page, "imp2-collapsed-default.png");

  // 3) 点击展开侧栏（展开后才能看到模式 toggle）
  await click(page, ".collapse-btn");
  await waitFor(
    page,
    () => !document.querySelector(".panel.collapsed"),
    8000,
    "侧栏展开",
  );
  log("③ 点击后侧栏已展开 ✔");

  // 4) 模式 toggle 顺序：聚类在前，Cesium 在后
  const segLabels = await page.$$eval(".seg button", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  log("④ 模式按钮顺序:", JSON.stringify(segLabels));
  if (segLabels[0].includes("聚类") && segLabels[1].includes("Cesium")) {
    log("✔ 顺序正确：聚类第一、Cesium 第二");
  } else {
    throw new Error("模式按钮顺序不正确: " + JSON.stringify(segLabels));
  }
  await shot(page, "imp2-expanded-constellation.png");

  // 5) 切到 Cesium 模式，验证多选框
  await click(page, ".seg button", 1); // 第二个按钮 = 全部卫星 (Cesium)
  await waitFor(
    page,
    () => !!document.querySelector(".chk-list"),
    15000,
    "Cesium 多选框出现",
  );
  await sleep(2500); // 等待 Cesium 构建
  const totalGroups = await page.$$eval(".chk-list .chk", (els) => els.length);
  const checkedAll = await page.$$eval(".chk-list input", (els) =>
    els.filter((i) => i.checked).length,
  );
  log("⑤ 星座复选框数 =", totalGroups, "，默认勾选 =", checkedAll);
  if (totalGroups < 2) throw new Error("复选框数量异常: " + totalGroups);
  if (checkedAll !== totalGroups) throw new Error("默认未全选");

  const metaBefore = await page.$eval(".meta b", (e) => e.textContent);
  log("   全选时当前数据 =", metaBefore, "颗");
  await shot(page, "imp2-cesium-allchecked.png");

  // 6) 反选 → 应全部取消
  await click(page, ".filter-actions button", 1); // 反选
  await sleep(500);
  const checkedAfterInvert = await page.$$eval(".chk-list input", (els) =>
    els.filter((i) => i.checked).length,
  );
  log("⑥ 反选后勾选数 =", checkedAfterInvert, "（应为 0）");
  if (checkedAfterInvert !== 0) throw new Error("反选未清空");
  const metaNone = await page.$eval(".meta b", (e) => e.textContent);
  log("   反选后当前数据 =", metaNone, "颗");
  if (Number(metaNone) !== 0) throw new Error("反选后仍有卫星绘制: " + metaNone);

  // 7) 全选 → 恢复
  await click(page, ".filter-actions button", 0); // 全选
  await sleep(400);
  const checkedAfterAll = await page.$$eval(".chk-list input", (els) =>
    els.filter((i) => i.checked).length,
  );
  log("⑦ 全选后勾选数 =", checkedAfterAll, "（应 =", totalGroups, "）");
  if (checkedAfterAll !== totalGroups) throw new Error("全选未恢复");

  // 8) 反选后再单独勾选 starlink，验证筛选生效（数据量应下降）
  await click(page, ".filter-actions button", 1); // 反选 → 全空
  await sleep(300);
  await click(page, ".chk-list .chk input", 0); // 勾选第一个（通常 starlink/最多）
  await sleep(2500); // 等待 Cesium 重建
  const metaFiltered = await page.$eval(".meta b", (e) => e.textContent);
  log("⑧ 单选首个星座后当前数据 =", metaFiltered, "颗");
  await shot(page, "imp2-cesium-filtered.png");

  log("=== 控制台错误数:", errors.length, "===");
  if (errors.length) {
    errors.slice(0, 10).forEach((e) => log("  ⚠", e));
    throw new Error("存在控制台错误");
  }
  log("✅ 全部断言通过");
} catch (e) {
  log("❌ 测试失败:", e.message);
  try {
    await page.screenshot({ path: `${OUT}/imp2-fail.png` });
    log("📸 imp2-fail.png");
  } catch {}
  log("控制台错误:", errors.slice(0, 10));
  process.exitCode = 1;
} finally {
  await browser.close();
}
