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
const label = process.argv[3] || "industry-directory-local";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid evidence label");
const output = new URL(`./evidence/${label}/`, import.meta.url);
await mkdir(output, { recursive: true });

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
      await context.addInitScript((value) =>
        localStorage.setItem("chituo-theme", value),
      theme);
      const page = await context.newPage();
      const entry = {
        width,
        height,
        theme,
        errors: [],
        badResponses: [],
        searches: {},
      };
      page.on("pageerror", (error) => entry.errors.push(error.message));
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          response.url().startsWith(base.origin)
        )
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
      };
      for (const query of [
        "正帆",
        "至纯",
        "吉姆西",
        "华虹",
        "长江存储",
        "长芯",
        "长鑫",
      ]) {
        await page.locator("#resource-search").fill(query);
        entry.searches[query] = {
          cards: await page.locator(".resource-card").count(),
          count: await page.locator("#resource-count").textContent(),
          empty: await page.locator("#resource-empty").isVisible(),
        };
      }
      await page.locator("#resource-search").fill("深圳市镭赫技术有限公司");
      entry.accessibleOfficial = {
        cards: await page.locator(".resource-card").count(),
        links: await page.locator("a.official-link").count(),
      };
      await page.locator("#resource-search").fill("爱德华真空");
      entry.unreachableOfficial = {
        cards: await page.locator(".resource-card").count(),
        links: await page.locator("a.official-link").count(),
        unavailable: await page.locator(".pending-link").allTextContents(),
      };
      await page.locator("#resource-reset").click();
      await page.locator("#resource-region").selectOption("china");
      await page
        .locator("#resource-source")
        .selectOption("event:CSEAC 2026");
      entry.combined = {
        cards: await page.locator(".resource-card").count(),
        count: await page.locator("#resource-count").textContent(),
      };
      await page.locator("#resource-reset").click();
      await page
        .locator("#resource-verification")
        .selectOption("verified_official");
      entry.verified = {
        cards: await page.locator(".resource-card").count(),
        count: await page.locator("#resource-count").textContent(),
        officialLinks: await page.locator("a.official-link").count(),
        officialLinkLabels: await page
          .locator("a.official-link")
          .allTextContents(),
        unavailableLabels: await page
          .locator(".pending-link")
          .allTextContents(),
      };
      await page.locator("#resource-reset").click();
      await page.locator("#resource-next").click();
      entry.nextPage = await page.locator("#resource-page").textContent();
      entry.audit = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        mode: document.documentElement.dataset.themeMode,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        unsafeExternalLinks: [
          ...document.querySelectorAll('a[href^="http"]'),
        ]
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
      await page.screenshot({
        path: fileURLToPath(
          new URL(`directory-${theme}-${width}.png`, output),
        ),
        fullPage: true,
      });
      results.push(entry);
      await context.close();
    }
  }
  const failures = results.filter(
    (entry) =>
      entry.status !== 200 ||
      entry.errors.length ||
      entry.badResponses.length ||
      entry.initial.cards !== 24 ||
      !entry.initial.count.includes("总库 1955 条") ||
      !entry.initial.count.includes("已核官网 203 条") ||
      !entry.initial.count.includes("当前可访问 196 条") ||
      !entry.initial.count.includes("待核 1752 条") ||
      entry.initial.page !== "第 1 / 82 页" ||
      entry.searches["吉姆西"].cards !== 1 ||
      entry.searches["长芯"].cards !== 0 ||
      !entry.searches["长芯"].empty ||
      entry.accessibleOfficial.cards !== 1 ||
      entry.accessibleOfficial.links !== 1 ||
      entry.unreachableOfficial.cards !== 1 ||
      entry.unreachableOfficial.links !== 0 ||
      !entry.unreachableOfficial.unavailable.some((label) =>
        label.includes("当前不可达"),
      ) ||
      entry.combined.cards !== 24 ||
      entry.verified.cards !== 24 ||
      entry.verified.officialLinks < 1 ||
      entry.verified.officialLinks > entry.verified.cards ||
      entry.verified.officialLinkLabels.some(
        (label) => label.trim() !== "打开官方网站",
      ) ||
      !entry.verified.count.includes("匹配 203 条") ||
      entry.nextPage !== "第 2 / 82 页" ||
      entry.audit.horizontalOverflow ||
      entry.audit.unsafeExternalLinks.length ||
      entry.audit.privateLabelsVisible,
  );
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      { timestamp: new Date().toISOString(), base: base.href, results, failures },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ scenarios: results.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
