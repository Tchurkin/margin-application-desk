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
