import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH ||
  "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const OUT = "/workspace/tests/playwright";
const errors = [];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 等待散点图卡片渲染
  await waitFor(page, () => !!document.querySelector(".chart-card"), 20000, "chart-card 出现");
  await sleep(1500);

  // 2) 控制条在散点图下方，两个按钮各占一半宽
  const geo = await page.evaluate(() => {
    const card = document.querySelector(".chart-card");
    const chart = card.querySelector(".scatter-chart").getBoundingClientRect();
    const actions = card.querySelector(".chart-actions").getBoundingClientRect();
    const btns = [...card.querySelectorAll(".chart-actions .ctrl-btn")].map((b) =>
      b.getBoundingClientRect(),
    );
    return {
      chartBottom: chart.bottom,
      actionsTop: actions.top,
      actionsWidth: actions.width,
      btnCount: btns.length,
      btnWidths: btns.map((b) => Math.round(b.width)),
    };
  });
  log("② 散点图底 =", geo.chartBottom.toFixed(0), "，控制条顶 =", geo.actionsTop.toFixed(0));
  if (geo.actionsTop <= geo.chartBottom) throw new Error("控制条未在散点图下方");
  if (geo.btnCount !== 2) throw new Error("控制条按钮数 != 2，实际=" + geo.btnCount);
  const half = geo.actionsWidth / 2;
  const w0 = geo.btnWidths[0];
  const w1 = geo.btnWidths[1];
  log("   控制条宽 =", geo.actionsWidth.toFixed(0), "，两按钮宽 =", w0, w1);
  if (Math.abs(w0 - half) > half * 0.2 || Math.abs(w1 - half) > half * 0.2) {
    throw new Error("按钮未各占约一半宽: " + JSON.stringify(geo.btnWidths));
  }
  log("✔ 控制条在图下方、两按钮各占约一半宽");

  // 3) 点击“高度壳层”按钮 → 出现壳层多选面板，复选框数 == 按钮标注的壳层数
  const labelN = await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".chart-card .chart-actions .ctrl-btn")];
    const shellBtn = btns.find((b) => b.textContent.includes("高度壳层"));
    return shellBtn?.textContent.match(/\((\d+)\)/)?.[1];
  });
  await click(page, ".chart-card .chart-actions .ctrl-btn", 1); // 第二个按钮 = 高度壳层
  await waitFor(
    page,
    () => !!document.querySelector(".chart-card .shell-panel"),
    8000,
    "高度壳层面板出现",
  );
  await sleep(400);
  const shellInfo = await page.evaluate(() => {
    const card = document.querySelector(".chart-card");
    const items = card.querySelectorAll(".shell-panel .shell-item");
    const checked = [...items].filter((i) => i.querySelector("input").checked).length;
    const names = [...items].map((i) => i.querySelector(".shell-text").textContent);
    return { count: items.length, checked, names };
  });
  log("③ 高度壳层按钮标注壳层数 =", labelN, "，面板复选框数 =", shellInfo.count, "，默认勾选 =", shellInfo.checked);
  if (Number(labelN) !== shellInfo.count) throw new Error("壳层复选框数与标注不符");
  if (shellInfo.checked !== shellInfo.count) throw new Error("默认未全选壳层");
  log("   壳层明细:", JSON.stringify(shellInfo.names));
  await page.screenshot({ path: `${OUT}/imp3-shell-panel.png` });
  log("📸 imp3-shell-panel.png");

  // 4) LEO 细粒度校验：starlink 首个倾角壳层应被细分为多个高度壳层（>=3 说明 50km 粒度生效）
  if (shellInfo.count < 3) {
    log("⚠ 首个倾角壳层高度壳层数 =", shellInfo.count, "，疑似粒度未细化（期望 >=3）");
  } else {
    log("✔ 高度壳层细粒度生效（首个倾角壳层分为 " + shellInfo.count + " 个壳层）");
  }

  // 5) 反选 → 全部取消勾选；再全选 → 全部恢复
  await click(page, ".chart-card .shell-panel .mini-btn", 1); // 反选
  await sleep(300);
  const afterInvert = await page.$$eval(
    ".chart-card .shell-panel .shell-item input",
    (els) => els.filter((i) => i.checked).length,
  );
  log("⑤ 反选后勾选数 =", afterInvert, "（应为 0）");
  if (afterInvert !== 0) throw new Error("反选未清空");
  await click(page, ".chart-card .shell-panel .mini-btn", 0); // 全选
  await sleep(300);
  const afterAll = await page.$$eval(
    ".chart-card .shell-panel .shell-item input",
    (els) => els.filter((i) => i.checked).length,
  );
  log("   全选后勾选数 =", afterAll, "（应 =", shellInfo.count, "）");
  if (afterAll !== shellInfo.count) throw new Error("全选未恢复");

  // 6) 单独取消一个壳层 → 勾选数减 1，且图表无报错（筛选生效）
  await click(page, ".chart-card .shell-panel .shell-item input", 0);
  await sleep(400);
  const afterUncheck = await page.$$eval(
    ".chart-card .shell-panel .shell-item input",
    (els) => els.filter((i) => i.checked).length,
  );
  log("⑥ 取消 1 个壳层后勾选数 =", afterUncheck, "（应 =", shellInfo.count - 1, "）");
  if (afterUncheck !== shellInfo.count - 1) throw new Error("取消单个壳层失败");
  await page.screenshot({ path: `${OUT}/imp3-filtered.png` });
  log("📸 imp3-filtered.png");

  // 7) 切到 Cesium 模式，确认新增的 qianfan / hulianwang 出现在星座多选框
  await click(page, ".collapse-btn");
  await waitFor(page, () => !document.querySelector(".panel.collapsed"), 8000, "侧栏展开");
  await click(page, ".seg button", 1); // 全部卫星 (Cesium)
  await waitFor(page, () => !!document.querySelector(".chk-list"), 15000, "Cesium 多选框出现");
  await sleep(2000);
  const cesiumGroups = await page.$$eval(".chk-list .chk", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  log("⑦ Cesium 星座复选框:", JSON.stringify(cesiumGroups));
  if (!cesiumGroups.some((g) => g.includes("qianfan")))
    throw new Error("Cesium 多选缺少 qianfan");
  if (!cesiumGroups.some((g) => g.includes("hulianwang")))
    throw new Error("Cesium 多选缺少 hulianwang");
  log("✔ qianfan / hulianwang 已在星座多选框中");

  log("=== 控制台错误数:", errors.length, "===");
  if (errors.length) {
    errors.slice(0, 10).forEach((e) => log("  ⚠", e));
    throw new Error("存在控制台错误");
  }
  log("✅ 全部断言通过");
} catch (e) {
  log("❌ 测试失败:", e.message);
  try {
    await page.screenshot({ path: `${OUT}/imp3-fail.png` });
    log("📸 imp3-fail.png");
  } catch {}
  log("控制台错误:", errors.slice(0, 10));
  process.exitCode = 1;
} finally {
  await browser.close();
}
