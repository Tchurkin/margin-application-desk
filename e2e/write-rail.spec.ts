import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

/*
 * The Write page's list of colleges and pieces keeps its place: opening a piece far down the list
 * loads a new page, and the list must still be where it was, not back at the top.
 */

test("opening a piece far down the Files list keeps the list where it was", async ({ page }) => {
  await signUp(page, "railscroll");

  // Fifteen colleges, each with one essay, through the connector (as Claude would add them).
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const link = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  const colleges = Array.from({ length: 15 }, (_, i) => ({
    name: `Testy College ${String(i + 1).padStart(2, "0")}`,
    round: "RD",
    pieces: [{ title: `Why College ${i + 1}`, prompt: "Why us?", limit_value: 250 }],
  }));
  const made = (await client.callTool({ name: "set_up_colleges", arguments: { colleges } })) as { isError?: boolean };
  expect(made.isError).toBeFalsy();
  await client.close();

  await page.goto("/desk/write");
  const rail = page.getByRole("tree", { name: "Colleges and pieces" });
  await expect(rail.getByRole("treeitem", { name: /^Testy College 15/ })).toBeAttached({ timeout: 15_000 });
  const panel = page.locator("#side-panel > div").last();
  await panel.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  // Open the last college's essay: a new page, and the list is still scrolled down to it.
  const last = rail.getByRole("treeitem", { name: /^Testy College 15/ });
  await last.locator("> div").first().click();
  await page.waitForURL(/\/desk\/piece\//);
  await expect(page.getByRole("tree", { name: "Colleges and pieces" }).getByRole("treeitem", { name: /^Why College 15/ })).toBeInViewport();
  await expect.poll(() => page.locator("#side-panel > div").last().evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
});

test("opening an essay from the far end of its college's tabs keeps the tabs where they were", async ({ page }) => {
  await signUp(page, "tabscroll");
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const link = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  // One college with twelve essays: more tabs than fit across.
  const pieces = Array.from({ length: 12 }, (_, i) => ({ title: `Short answer number ${i + 1}`, prompt: "Tell us more.", limit_value: 150 }));
  const made = (await client.callTool({ name: "set_up_colleges", arguments: { colleges: [{ name: "Testy University", round: "EA", pieces }] } })) as {
    isError?: boolean;
  };
  expect(made.isError).toBeFalsy();
  await client.close();

  // Write opens the college's first essay.
  await page.goto("/desk/write");
  await page.waitForURL(/\/desk\/piece\//);
  const tabs = page.getByRole("tablist", { name: "Pieces" });
  await expect(tabs.getByRole("tab")).toHaveCount(12);
  await tabs.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

  const lastTab = tabs.getByRole("tab", { name: /Short answer number 12/ });
  await lastTab.click();
  await expect(page.getByRole("tablist", { name: "Pieces" }).getByRole("tab", { name: /Short answer number 12/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "Pieces" }).getByRole("tab", { name: /Short answer number 12/ })).toBeInViewport();
  await expect.poll(() => page.getByRole("tablist", { name: "Pieces" }).evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
});

test("a college in the Files list folds by a click anywhere on it, as it opens", async ({ page }) => {
  await signUp(page, "railfold");
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const link = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  const colleges = ["Testy College A", "Testy College B"].map((name) => ({ name, round: "RD", pieces: [{ title: `Why ${name}`, prompt: "Why us?", limit_value: 250 }] }));
  expect(((await client.callTool({ name: "set_up_colleges", arguments: { colleges } })) as { isError?: boolean }).isError).toBeFalsy();
  await client.close();

  await page.goto("/desk/write");
  await page.waitForURL(/\/desk\/piece\//);
  const rail = page.getByRole("tree", { name: "Colleges and pieces" });
  const b = rail.getByRole("treeitem", { name: /^Testy College B/ });
  // Closed: a click on its name opens it, and its essay.
  await expect(b).toHaveAttribute("aria-expanded", "false");
  await b.getByText("Testy College B", { exact: true }).click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
  await expect(rail.getByRole("treeitem", { name: /^Why Testy College B/ })).toHaveAttribute("aria-current", "page");
  // Open: a click on its name (not just the caret) folds it.
  await b.getByText("Testy College B", { exact: true }).click();
  await expect(b).toHaveAttribute("aria-expanded", "false");
  await expect(rail.getByRole("treeitem", { name: /^Why Testy College B/ })).toHaveCount(0);
  // And opens again.
  await b.getByText("Testy College B", { exact: true }).click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
});
