import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.APP_ORIGIN,
  output = ".local/phase6-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  }),
  findings = [],
  errors = [];
async function audit(page, name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = result.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact),
  );
  findings.push({
    name,
    violations: violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await audit(page, "login");
  await page.locator("input[name=email]").fill(process.env.SEED_OWNER_EMAIL);
  await page
    .locator("input[name=password]")
    .fill(process.env.SEED_OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await page.getByRole("heading", { name: "Business overview" }).waitFor();
  for (const tab of [
    "Overview",
    "Sales",
    "Customers",
    "Marketing",
    "Job cards",
    "Inventory",
    "Attendance",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(250);
    await audit(page, tab);
  }
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "New transaction",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest("[role=dialog]"),
    ),
    true,
  );
  for (let i = 0; i < 70; i++) await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest("[role=dialog]"),
    ),
    true,
  );
  await audit(page, "checkout dialog");
  await page.keyboard.press("Escape");
  await assert.doesNotReject(() => dialog.waitFor({ state: "hidden" }));
  assert.equal(
    await trigger.evaluate((e) => e === document.activeElement),
    true,
  );
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of [
      "Sales",
      "Customers",
      "Marketing",
      "Job cards",
      "Inventory",
    ]) {
      if (await page.locator(".mobile-toggle").isVisible()) await page.locator(".mobile-toggle").click();
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        tab + " page overflow",
      );
      await page.screenshot({
        path: `${output}/${tab.toLowerCase().replaceAll(" ", "-")}-${width}.png`,
        fullPage: true,
      });
    }
    await audit(page, "mobile-" + width);
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ errors, findings }, null, 2),
  );
  assert.deepEqual(errors, []);
  assert.equal(
    findings.reduce((n, f) => n + f.violations.length, 0),
    0,
    "Serious accessibility violations: inspect browser report",
  );
  console.log(
    "Phase 6 browser checks passed: CSP-compatible interactions, WCAG automated checks on login and seven views, modal focus trap/restore/Escape, and phone/tablet views without page overflow.",
  );
} finally {
  await browser.close();
}
