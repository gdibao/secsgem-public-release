import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(new URL("./browsers", import.meta.url));
const { chromium } = await import("playwright");
const base = new URL(process.argv[2] || "http://127.0.0.1:8876");
if (!["127.0.0.1", "localhost", "www.gdibao.com", "gdibao.com"].includes(base.hostname)) throw new Error("Unapproved target");
const label = process.argv[3] || "directory-submission";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid evidence label");
const output = new URL(`./evidence/${label}/`, import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
const results = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      await context.addInitScript((value) => localStorage.setItem("chituo-theme", value), theme);
      const page = await context.newPage();
      const entry = { width, height, theme, errors: [], badResponses: [] };
      page.on("pageerror", (error) => entry.errors.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400 && response.url().startsWith(base.origin)) entry.badResponses.push({ url: response.url(), status: response.status() });
      });
      const response = await page.goto(new URL("/industry-resources/", base).href, { waitUntil: "networkidle" });
      entry.status = response.status();
      await page.locator("#company-submit-open").click();
      await page.locator('input[name="company"]').fill("验收测试企业（不入库）有限公司");
      await page.locator('input[name="website"]').fill("https://example.com/");
      await page.locator('select[name="role"]').selectOption({ label: "设备厂商" });
      await page.locator('input[name="region"]').fill("测试地区");
      await page.locator('input[name="domains"][value="fab"]').check();
      await page.locator('textarea[name="source_note"]').fill("仅用于隔离页面验收，不提交生产资料库");
      await page.locator('input[name="contact_name"]').fill("测试联系人");
      await page.locator('input[name="contact_method"]').fill("test@example.invalid");
      await page.locator("#directory-captcha-range").fill("80");
      await page.locator('#company-submit-form button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("#company-submit-status")?.textContent?.includes("受理编号"));
      entry.audit = await page.evaluate(() => ({
        dialogOpen: document.querySelector("#company-submit-dialog")?.open,
        status: document.querySelector("#company-submit-status")?.textContent,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        privateNotice: document.body.innerText.includes("仅供管理员审核，不会进入公开目录"),
        officialButtonLegacyLabels: [...document.querySelectorAll("a.official-link")].filter((link) => link.textContent.trim() !== "打开官方网站").length,
      }));
      await page.screenshot({ path: fileURLToPath(new URL(`submission-${theme}-${width}.png`, output)), fullPage: true });
      results.push(entry);
      await context.close();
    }
  }
  const failures = results.filter((entry) => entry.status !== 200 || entry.errors.length || entry.badResponses.length || !entry.audit.dialogOpen || !entry.audit.status.includes("900001") || entry.audit.horizontalOverflow || !entry.audit.privateNotice || entry.audit.officialButtonLegacyLabels);
  await writeFile(new URL("result.json", output), JSON.stringify({ timestamp: new Date().toISOString(), base: base.href, results, failures }, null, 2));
  console.log(JSON.stringify({ scenarios: results.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
