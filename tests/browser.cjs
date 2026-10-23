// Run after: npm install --no-save playwright && npx playwright install chromium
// Start the localhost server first: bash tools/preview.sh
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  // Poll from Node: older Playwright waitForFunction uses eval blocked by this page's CSP.
  async function waitFor(page, predicate, arg, options = {}) {
    const deadline = Date.now() + (options.timeout || 30000);
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate, arg)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for: " + predicate.toString());
  }
  let passed = 0;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const check = (name, fn) => {
    assert.ok(fn, name);
    console.log("PASS", name);
    passed++;
  };
  try {
    await page.goto("http://127.0.0.1:8765");
    await waitFor(page, 
      () => +document.querySelector("#stage").dataset.paths > 0,
    );
    check(
      "Retina canvas",
      await page
        .locator("#stage")
        .evaluate(
          (c) => c.width === Math.round(c.getBoundingClientRect().width * 2),
        ),
    );
    for (const t of [0.6, 2.2, 4.2, 6.5, 8.5]) {
      await page.locator("#timeline").evaluate((e, t) => {
        e.value = t;
        e.dispatchEvent(new Event("input"));
      }, t);
      check(
        "seek " + t,
        (await page.locator(".window").getAttribute("data-elapsed")) ===
          t.toFixed(3),
      );
    }
    await page.locator("#settings").click();
    await page.locator("#duration").fill("5");
    await page.locator("#welcomeText").fill("HELLO LAB");
    await page.locator("#save").click();
    await waitFor(page, () => !document.querySelector("dialog").open);
    await page.reload();
    await waitFor(page, 
      () => +document.querySelector("#stage").dataset.paths > 0,
    );
    await page.locator("#settings").click();
    check(
      "settings persisted",
      (await page.locator("#duration").inputValue()) === "5" &&
        (await page.locator("#welcomeText").inputValue()) === "HELLO LAB",
    );
    await page.locator(".close").click();
    await page.keyboard.press("Escape");
    check(
      "skip completes",
      (await page.locator(".window").getAttribute("data-completed")) === "true",
    );
    await page.locator("#replay").click();
    await waitFor(page, 
      () => document.querySelector(".window").dataset.completed === "true",
      {},
      { timeout: 10000 },
    );
    check(
      "natural completion stops rAF",
      (await page.locator(".window").getAttribute("data-playing")) === "false",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#replay").click();
    await page.waitForTimeout(200);
    check("reduced motion runtime survives", errors.length === 0);
    const broken = await context.newPage();
    await broken.route("**/assets/character.png", (route) => route.abort());
    await broken.goto("http://127.0.0.1:8765");
    await waitFor(broken, () =>
      document.querySelector("#notice").textContent.includes("素材加载失败"),
    );
    check(
      "failed image uses fallback",
      (await broken.locator("#stage").getAttribute("data-image-width")) === "0",
    );
    await broken.close();
    await page.goto("http://127.0.0.1:8765/.build/extension-preview/");
    await waitFor(page, () => window.__aemeathExtension?.status().ready);
    const frame = page.frameLocator("#aemeath-extension-overlay");
    await frame.locator("#skip").click();
    await waitFor(page, 
      () => !document.querySelector("#aemeath-extension-overlay"),
    );
    await page.locator("#ready").click();
    check(
      "overlay removed and host clickable",
      (await page.locator("#ready").textContent()) === "点击成功",
    );
    await page.locator("#settings").click();
    await page
      .frameLocator("#aemeath-extension-overlay")
      .locator("dialog")
      .waitFor({ state: "visible" });
    await page
      .frameLocator("#aemeath-extension-overlay")
      .locator("#restore")
      .click();
    check(
      "restore removes extension",
      await page.evaluate(
        () =>
          !window.__aemeathExtension &&
          !document.querySelector("#aemeath-extension-overlay"),
      ),
    );
    check("no page errors", errors.length === 0);
    console.log(`${passed} checks passed`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
