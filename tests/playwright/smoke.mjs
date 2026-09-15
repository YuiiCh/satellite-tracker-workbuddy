// 自主冒烟测试：用 Playwright 打开前端，校验两种视图渲染、捕获控制台错误并截图。
// 说明：无 GPU 的软件 WebGL(swiftshader) + 大量卫星下，Playwright 的 waitForSelector 会卡死
// （元素已 attached/visible 仍超时）。故统一改用 page.evaluate 轮询 + DOM 级点击。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUT = process.env.OUT_DIR || "/workspace/tests/playwright";

const consoleErrors = [];
const pageErrors = [];

const log = (...a) => console.log("[test]", ...a);

async function main() {
  const browser = await chromium.launch({
    headless: false,
    executablePath:
      process.env.CHROME_PATH ||
      "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  // evaluate 轮询等待，避开 waitForSelector 卡死
  async function waitDom(fn, timeout = 30000, interval = 500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ok = await page.evaluate(fn).catch(() => false);
      if (ok) return true;
      await page.waitForTimeout(interval);
    }
    return false;
  }
  const clickText = (t) =>
    page.evaluate((txt) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        x.textContent.includes(txt),
      );
      if (!b) return false;
      b.click();
      return true;
    }, t);
  const selectGroup = (g) =>
    page.evaluate((grp) => {
      const s = document.querySelector("select");
      if (!s) return false;
      s.value = grp;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, g);

  log("打开", BASE);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });

  await waitDom(() => !!document.querySelector(".layout"), 30000);
  log("应用骨架已加载");

  // 默认侧栏收起：先展开左侧栏
  await page.evaluate(() => {
    const b = document.querySelector(".collapse-btn");
    if (b) b.click();
  });
  await waitDom(() => !document.querySelector(".panel.collapsed"), 10000);
  log("侧栏已展开");

  // —— 视图一：全部卫星（Cesium）——
  await clickText("全部卫星");
  await waitDom(() => !!document.querySelector(".cesium-container canvas"), 40000);
  log("Cesium canvas 已出现");

  let drawn = 0;
  await waitDom(
    () => {
      const el = document.querySelector(".content-head .stat");
      const m = el && el.textContent && el.textContent.match(/已绘制\s+(\d+)/);
      return !!(m && Number(m[1]) > 0);
    },
    90000,
  );
  drawn = await page
    .evaluate(() => {
      const el = document.querySelector(".content-head .stat");
      const m = el && el.textContent && el.textContent.match(/已绘制\s+(\d+)/);
      return m ? Number(m[1]) : 0;
    })
    .catch(() => 0);
  log("Cesium 已绘制卫星数:", drawn);
  await page.screenshot({ path: `${OUT}/view-all.png` });
  log("截图 view-all.png");

  // 时间倍率滑块（设为 10×）
  await page.evaluate(() => {
    const el = document.querySelector('input[type="range"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, "10");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/view-all-m10.png` });
  log("倍率调整至 10×，截图 view-all-m10.png");

  // —— 视图二：星座轨道分析（聚类散点）——
  await clickText("星座轨道分析");
  await waitDom(() => !!document.querySelector("select"), 20000);
  const hasBeidou = await page.evaluate(() =>
    [...document.querySelectorAll("select option")].some(
      (o) => o.value === "beidou",
    ),
  );
  if (hasBeidou) {
    await selectGroup("beidou");
    log("选择星座 beidou");
  } else {
    log("未找到 beidou，使用默认选项");
  }
  await waitDom(() => !!document.querySelector(".chart-box"), 40000);
  await page.waitForTimeout(3500);

  const chartBoxes = await page.$$(".chart-box");
  const summaryTxt = await page
    .evaluate(
      () =>
        (document.querySelector(".scatter-wrap .summary") || {}).textContent || "",
    )
    .catch(() => "");
  log("散点图数量:", chartBoxes.length, "| 摘要:", String(summaryTxt).trim());
  await page.screenshot({ path: `${OUT}/view-constellation.png`, fullPage: false });
  log("截图 view-constellation.png");

  // 单壳层星座（oneweb）确认单簇正常
  const hasOneweb = await page.evaluate(() =>
    [...document.querySelectorAll("select option")].some(
      (o) => o.value === "oneweb",
    ),
  );
  if (hasOneweb) {
    await selectGroup("oneweb");
    await page.waitForTimeout(3000);
    const c2 = await page.$$(".chart-box");
    log("oneweb 散点图数量:", c2.length);
    await page.screenshot({ path: `${OUT}/view-oneweb.png` });
  }

  await browser.close();

  const realErrors = consoleErrors.filter(
    (t) => !/Failed to load resource|net::ERR|favicon/i.test(t),
  );
  log("==== 结果 ====");
  log("Cesium 绘制卫星数:", drawn);
  log("散点图(beidou)数量:", chartBoxes.length);
  log("控制台 error 数:", realErrors.length);
  realErrors.slice(0, 10).forEach((t) => log("  CONSOLE-ERR:", t.slice(0, 200)));
  log("页面异常数:", pageErrors.length);
  pageErrors.slice(0, 10).forEach((t) => log("  PAGE-ERR:", t.slice(0, 200)));

  const ok = chartBoxes.length > 0 && pageErrors.length === 0;
  log(ok ? "PASS ✅" : "FAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] 异常:", e);
  process.exit(2);
});
