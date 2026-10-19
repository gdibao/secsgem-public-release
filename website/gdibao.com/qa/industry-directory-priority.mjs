import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(
  new URL("./browsers", import.meta.url),
);
const { chromium } = await import("playwright");
const base = new URL(process.argv[2] || "http://127.0.0.1:8876");
if (
  !["127.0.0.1", "localhost", "www.gdibao.com", "gdibao.com"].includes(
    base.hostname,
  )
)
  throw new Error("Unapproved target");
const label = process.argv[3] || "industry-directory-priority-local";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid evidence label");
const output = new URL(`./evidence/${label}/`, import.meta.url);
await mkdir(output, { recursive: true });

const expectedVerifiedPriority = [
  "爱思强",
  "雅各布斯",
  "林德",
  "富士金",
  "世伟洛克",
  "开滋半导体",
  "奥加诺",
  "荏原精密机械",
  "普发真空",
  "AAF 国际",
  "Envirco",
  "施耐德电气",
  "西门子",
  "欧姆龙自动化",
  "罗克韦尔自动化",
  "基恩士",
  "横河电机",
  "思科",
  "Cimetrix",
];
const expectedPendingPriority = [
  "液化空气电子业务",
  "栗田工业",
  "爱德华真空",
  "SEMI 国际标准",
  "欧特克 Plant 3D",
  "ISO 洁净室标准",
  "IEC 功能安全标准",
];
const primaryHeadings = (locator) =>
  locator.evaluateAll((headings) =>
    headings.map((heading) => heading.childNodes[0]?.textContent?.trim() || ""),
  );

const browser = await chromium.launch({
  headless: true,
  executablePath: chromium.executablePath(),
});
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const theme of ["light", "dark", "system"]) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      await context.addInitScript((value) => {
        localStorage.setItem("chituo-theme", value);
        localStorage.setItem("gdibao-directory-view", "pending");
        localStorage.setItem("resource-verification", "unverified");
      }, theme);
      const page = await context.newPage();
      if (["127.0.0.1", "localhost"].includes(base.hostname)) {
        await page.route("**/directory-api/directory/approved", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, items: [] }),
          }),
        );
      }
      const entry = {
        width,
        height,
        theme,
        errors: [],
        badResponses: [],
      };
      page.on("pageerror", (error) => entry.errors.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400 && response.url().startsWith(base.origin))
          entry.badResponses.push({
            url: response.url(),
            status: response.status(),
          });
      });

      const response = await page.goto(
        new URL("/industry-resources/", base).href,
        { waitUntil: "networkidle" },
      );
      entry.status = response.status();
      entry.initial = {
        cards: await page.locator(".resource-card").count(),
        count: await page.locator("#resource-count").textContent(),
        page: await page.locator("#resource-page").textContent(),
        names: await primaryHeadings(page.locator(".resource-card h2")),
        stars: await page.locator(".curated-priority").count(),
        priorityLabels: await page
          .locator(".curated-priority")
          .evaluateAll((items) => items.map((item) => item.ariaLabel)),
        selectedView: await page
          .locator('.resource-view-switch button[aria-selected="true"]')
          .textContent(),
      };
      await page.screenshot({
        path: fileURLToPath(
          new URL(`directory-verified-${theme}-${width}.png`, output),
        ),
        fullPage: true,
      });

      await page.locator("#resource-search").fill("爱德华真空");
      entry.hiddenPendingSearch = {
        cards: await page.locator(".resource-card").count(),
        empty: await page.locator("#resource-empty").isVisible(),
      };
      await page.locator("#resource-search").fill("");
      await page.locator("#resource-view-pending").click();
      entry.pending = {
        cards: await page.locator(".resource-card").count(),
        count: await page.locator("#resource-count").textContent(),
        page: await page.locator("#resource-page").textContent(),
        names: await primaryHeadings(page.locator(".resource-card h2")),
        stars: await page.locator(".curated-priority").count(),
        officialLinks: await page.locator("a.official-link").count(),
      };
      await page.screenshot({
        path: fileURLToPath(
          new URL(`directory-pending-${theme}-${width}.png`, output),
        ),
        fullPage: true,
      });
      await page.locator("#resource-search").fill("爱德华真空");
      entry.explicitPendingSearch = {
        cards: await page.locator(".resource-card").count(),
        stars: await page.locator(".curated-priority").count(),
        links: await page.locator("a.official-link").count(),
        labels: await page.locator(".pending-link").allTextContents(),
      };
      await page.locator("#resource-search").fill("绝对不存在的企业名称");
      entry.pendingEmpty = {
        cards: await page.locator(".resource-card").count(),
        empty: await page.locator("#resource-empty").isVisible(),
      };
      await page.locator("#resource-reset").click();
      entry.reset = {
        count: await page.locator("#resource-count").textContent(),
        selectedView: await page
          .locator('.resource-view-switch button[aria-selected="true"]')
          .textContent(),
        firstName: (
          await primaryHeadings(page.locator(".resource-card h2"))
        )[0],
      };
      await page.locator("#resource-domain").selectOption("gas");
      entry.domainOrder = await primaryHeadings(
        page.locator(".resource-card h2"),
      );
      await page.locator("#resource-reset").click();
      await page.locator("#resource-next").click();
      entry.nextPage = {
        label: await page.locator("#resource-page").textContent(),
        stars: await page.locator(".curated-priority").count(),
      };
      entry.audit = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        mode: document.documentElement.dataset.themeMode,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        unsafeExternalLinks: [...document.querySelectorAll('a[href^="http"]')]
          .filter(
            (link) =>
              new URL(link.href).origin !== location.origin &&
              (link.target !== "_blank" ||
                !link.relList.contains("noopener") ||
                !link.relList.contains("noreferrer")),
          )
          .map((link) => link.href),
        privateLabelsVisible: /联系人|手机号|采购备注|负责人/.test(
          document.body.innerText,
        ),
      }));

      await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
      entry.homePreview = {
        names: await page
          .locator(".curated-resource-preview a")
          .evaluateAll((items) =>
            items.map((item) => item.childNodes[item.childNodes.length - 1].textContent.trim()),
          ),
        hrefs: await page
          .locator(".curated-resource-preview a")
          .evaluateAll((items) => items.map((item) => item.getAttribute("href"))),
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
      };
      await page.locator(".curated-resource-preview a").first().click();
      await page.waitForLoadState("networkidle");
      entry.homePreviewTarget = {
        count: await page.locator("#resource-count").textContent(),
        name: (
          await primaryHeadings(page.locator(".resource-card h2"))
        )[0],
        view: await page
          .locator('.resource-view-switch button[aria-selected="true"]')
          .textContent(),
      };
      results.push(entry);
      await context.close();
    }
  }

  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const failures = results.filter(
    (entry) =>
      entry.status !== 200 ||
      entry.errors.length ||
      entry.badResponses.length ||
      entry.initial.cards !== 24 ||
      !entry.initial.count.includes("当前结果 208 条") ||
      !entry.initial.count.includes("总库 1955 条") ||
      !entry.initial.count.includes("已核官网 215 条") ||
      !entry.initial.count.includes("当前可访问 208 条") ||
      !entry.initial.count.includes("待核或不可达 1747 条") ||
      entry.initial.page !== "第 1 / 9 页" ||
      entry.initial.stars !== 19 ||
      !same(entry.initial.names.slice(0, 19), expectedVerifiedPriority) ||
      entry.initial.names[19] !== "«Dipaul Technologies»  Joint-Stock Company" ||
      entry.initial.priorityLabels.some(
        (label) => label !== "目录优先级：五星",
      ) ||
      entry.initial.selectedView.trim() !== "已核官网" ||
      entry.hiddenPendingSearch.cards !== 0 ||
      !entry.hiddenPendingSearch.empty ||
      entry.pending.cards !== 24 ||
      !entry.pending.count.includes("当前结果 1747 条") ||
      entry.pending.page !== "第 1 / 73 页" ||
      entry.pending.stars !== 7 ||
      entry.pending.officialLinks !== 0 ||
      !same(entry.pending.names.slice(0, 7), expectedPendingPriority) ||
      entry.explicitPendingSearch.cards !== 1 ||
      entry.explicitPendingSearch.stars !== 1 ||
      entry.explicitPendingSearch.links !== 0 ||
      !entry.explicitPendingSearch.labels.some((label) =>
        label.includes("当前不可达"),
      ) ||
      entry.pendingEmpty.cards !== 0 ||
      !entry.pendingEmpty.empty ||
      entry.reset.selectedView.trim() !== "已核官网" ||
      !entry.reset.count.includes("当前结果 208 条") ||
      entry.reset.firstName !== "爱思强" ||
      entry.domainOrder[0] !== "林德" ||
      entry.nextPage.label !== "第 2 / 9 页" ||
      entry.nextPage.stars !== 0 ||
      entry.audit.horizontalOverflow ||
      entry.audit.unsafeExternalLinks.length ||
      entry.audit.privateLabelsVisible ||
      entry.homePreview.names.join("|") !==
        "爱思强|雅各布斯|林德|富士金|世伟洛克|开滋半导体" ||
      entry.homePreview.hrefs.some((href) => !href.startsWith("/industry-resources/?q=")) ||
      entry.homePreview.overflow ||
      entry.homePreviewTarget.name !== "爱思强" ||
      entry.homePreviewTarget.view.trim() !== "已核官网" ||
      !entry.homePreviewTarget.count.includes("当前结果 1 条"),
  );
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      { timestamp: new Date().toISOString(), base: base.href, results, failures },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        scenarios: results.length,
        failures: failures.length,
        evidence: fileURLToPath(new URL("result.json", output)),
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
