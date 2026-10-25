import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

/* Settings > Appearance: a theme and the essay's text, kept in this browser across pages and reloads. */

test("a chosen theme and essay text hold across reloads, and Match my device lets go", async ({ page }) => {
  await signUp(page, "appearance");
  await page.goto("/desk/settings/appearance");
  const html = page.locator("html");
  await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
  await expect(html).not.toHaveAttribute("data-theme", /.+/);

  const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByTestId("theme-midnight").click();
  await expect(html).toHaveAttribute("data-theme", "midnight");
  await expect.poll(ground).toBe("rgb(15, 20, 32)");

  const size = () => page.getByTestId("appearance-preview").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const standard = await size();
  await page.getByTestId("essay-size-large").click();
  await expect.poll(size).toBeGreaterThan(standard);
  await page.getByTestId("essay-font-sans").click();
  await expect(html).toHaveAttribute("data-essay-font", "sans");

  // Another page, after a reload: set before the page is drawn.
  await page.goto("/desk");
  await expect(html).toHaveAttribute("data-theme", "midnight");
  await expect(html).toHaveAttribute("data-essay-size", "large");
  await expect.poll(ground).toBe("rgb(15, 20, 32)");

  await page.goto("/desk/settings/appearance");
  await expect(page.getByTestId("theme-midnight")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("essay-size-large")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("theme-system").click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
});
