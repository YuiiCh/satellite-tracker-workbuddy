// 自主冒烟测试：用 Playwright 打开前端，校验两种视图渲染、捕获控制台错误并截图。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUT = process.env.OUT_DIR || "/workspace/tests/playwright";

const consoleErrors = [];
const pageErrors = [];

function log(...a) {
  console.log("[test]", ...a);
}

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

  log("打开", BASE);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });

  // 应用骨架
  await page.waitForSelector(".layout", { timeout: 20000 });
  log("应用骨架已加载");

  // —— 视图一：全部卫星（Cesium）——
  await page.waitForSelector(".cesium-container canvas", { timeout: 30000 });
  log("Cesium canvas 已出现");

  // 等待 Cesium 完成建图（统计文案出现且数量 > 0）
  let drawn = 0;
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".content-head .stat");
        if (!el) return false;
        const m = el.textContent?.match(/已绘制\s+(\d+)/);
        return m && Number(m[1]) > 0;
      },
      { timeout: 45000 },
    );
    const txt = await page.$eval(".content-head .stat", (e) => e.textContent || "");
    drawn = Number(txt.match(/已绘制\s+(\d+)/)?.[1] || "0");
    log("Cesium 已绘制卫星数:", drawn);
  } catch (e) {
    log("等待 Cesium 绘制超时:", e.message);
  }
  await page.screenshot({ path: `${OUT}/view-all.png` });
  log("截图 view-all.png");

  // 测试时间倍率滑块（设为 10×）
  await page.$eval('input[type="range"]', (el) => {
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

  // —— 视图二：单星座聚类（散点）——
  await page.click("text=单星座聚类 (散点)");
  await page.waitForSelector("select", { timeout: 10000 });
  // 优先选 beidou（多壳层，最能体现聚类）；没有则保留默认
  const hasBeidou = await page.$$eval("select option", (opts) =>
    opts.some((o) => o.value === "beidou"),
  );
  if (hasBeidou) {
    await page.selectOption("select", "beidou");
    log("选择星座 beidou");
  } else {
    log("未找到 beidou，使用默认选项");
  }
  await page.waitForTimeout(3500);

  const chartCanvases = await page.$$(".scatter-chart canvas");
  const summaryTxt = await page
    .$eval(".scatter-wrap .summary", (e) => e.textContent || "")
    .catch(() => "");
  log("散点图数量:", chartCanvases.length, "| 摘要:", summaryTxt.trim());
  await page.screenshot({ path: `${OUT}/view-constellation.png`, fullPage: false });
  log("截图 view-constellation.png");

  // 再试一个单壳层星座（oneweb）确认单簇也正常
  const hasOneweb = await page.$$eval("select option", (opts) =>
    opts.some((o) => o.value === "oneweb"),
  );
  if (hasOneweb) {
    await page.selectOption("select", "oneweb");
    await page.waitForTimeout(3000);
    const c2 = await page.$$(".scatter-chart canvas");
    log("oneweb 散点图数量:", c2.length);
    await page.screenshot({ path: `${OUT}/view-oneweb.png` });
  }

  await browser.close();

  // —— 结果判定 ——
  const realErrors = consoleErrors.filter(
    (t) => !/Failed to load resource|net::ERR|favicon/i.test(t),
  );
  log("==== 结果 ====");
  log("Cesium 绘制卫星数:", drawn);
  log("散点图(beidou)数量:", chartCanvases.length);
  log("控制台 error 数:", realErrors.length);
  realErrors.slice(0, 10).forEach((t) => log("  CONSOLE-ERR:", t.slice(0, 200)));
  log("页面异常数:", pageErrors.length);
  pageErrors.slice(0, 10).forEach((t) => log("  PAGE-ERR:", t.slice(0, 200)));

  const ok = drawn > 0 && chartCanvases.length > 0 && pageErrors.length === 0;
  log(ok ? "PASS ✅" : "FAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] 异常:", e);
  process.exit(2);
});
