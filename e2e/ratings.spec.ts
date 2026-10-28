import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, essay, signUp, waitSaved } from "./helpers";

/*
 * Rate my essays: the board asks the counselor for a rating of every piece, the connector saves
 * them, and the board colors each card by its rating, faded once the piece is edited.
 */

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  try {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult;
    return { text: r.content.map((c) => c.text ?? "").join("\n"), isError: !!r.isError };
  } catch (e) {
    // Arguments the tool's schema rejects can come back as a protocol error instead.
    return { text: (e as Error).message, isError: true };
  }
}

async function connect(page: Page) {
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const link = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  return client;
}

const card = (page: Page, title: RegExp) => page.getByRole("slider", { name: title });

test("Rate my essays: ratings color the board, every college's pieces, faded once edited", async ({ page }) => {
  await signUp(page, "ratings");
  const college = await addCollege(page, "Testy Tech", { deadline: "2030-11-01" });
  const why = await addPiece(page, "Why Testy Tech", 250);
  await essay(page).click();
  await page.keyboard.insertText("I like the rockets club and the long winters.");
  await waitSaved(page);
  await page.goto(`/desk/college/${college}`);
  const empty = await addPiece(page, "Not started yet");
  const client = await connect(page);

  // The board asks; the request reaches the connector.
  await page.goto("/desk");
  await page.getByRole("button", { name: "Rate my essays" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for Claude to rate your essays" })).toBeVisible();
  const listed = await call(client, "list_desk_requests");
  expect(listed.text).toContain("(kind: rate)");
  expect(listed.text).toContain("set_piece_ratings");
  const requestId = listed.text.match(/request_id: ([0-9a-f-]{36})\] \(kind: rate\)/)![1];

  const saved = await call(client, "set_piece_ratings", {
    ratings: [{ piece_id: why, percentile: 72, reason: "Specific, with a real voice." }],
  });
  expect(saved.isError).toBe(false);
  expect(saved.text).toContain("Saved 1 rating");
  expect((await call(client, "set_piece_ratings", { ratings: [{ piece_id: why, percentile: 140, reason: "x" }] })).isError).toBe(true);
  expect((await call(client, "answer_request", { request_id: requestId, answer: "Rated your one essay: a solid 72." })).isError).toBe(false);

  // Once there are ratings the board colors by them; the empty piece stays hatched.
  await expect(page.getByText("Claude rated your essays")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Rating" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("rating-legend")).toBeVisible();
  const rated = card(page, /^Why Testy Tech/);
  await expect(rated).toHaveAccessibleName(/rated 72$/);
  await expect(rated.getByTestId("card-rating")).toHaveText("72");
  await expect(rated.locator("[data-band]")).toHaveAttribute("data-band", "ok");
  await expect(card(page, /^Not started yet/).locator("[data-band]")).toHaveAttribute("data-band", "none");

  // The connector shows it too.
  expect((await call(client, "read_piece", { piece_id: why })).text).toContain("Rated 72 by Claude");
  expect((await call(client, "list_my_desk")).text).toMatch(/Why Testy Tech .*rated 72 by Claude/);
  expect((await call(client, "read_piece", { piece_id: empty })).text).not.toContain("## Rating");
  const writing = (await call(client, "read_writing")).text;
  expect(writing).toContain("## Testy Tech");
  expect(writing).toContain("I like the rockets club and the long winters.");
  expect(writing).toMatch(/Why Testy Tech \[piece_id: [0-9a-f-]{36}\] .*rated 72/);
  expect(writing).toContain("empty: nothing to rate");
  expect(writing).toContain("This is all of it.");

  // Edited since: faded, and the connector says so.
  await page.goto(`/desk/piece/${why}`);
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" And the snow.");
  await waitSaved(page);
  await expect.poll(async () => (await call(client, "read_piece", { piece_id: why })).text, { timeout: 20_000 }).toContain("(edited since)");
  await page.goto("/desk");
  await expect(card(page, /^Why Testy Tech/)).toHaveAccessibleName(/rated 72, edited since$/);

  // Back to stage colors, kept across a reload.
  await page.getByRole("radio", { name: "Stage" }).click();
  await expect(page.getByTestId("rating-legend")).toHaveCount(0);
  await expect(card(page, /^Why Testy Tech/).locator("[data-band]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Stage" })).toHaveAttribute("aria-checked", "true");
  await client.close();
});

test("Rate this piece: one piece's rating and why, on its page, asked for from there", async ({ page }) => {
  await signUp(page, "rateone");
  await addCollege(page, "Testy State", { deadline: "2030-11-01" });
  const id = await addPiece(page, "Why Testy State", 250);
  await essay(page).click();
  await page.keyboard.insertText("I want to study rockets near the mountains.");
  await waitSaved(page);
  const client = await connect(page);
  await page.goto(`/desk/piece/${id}`);

  await page.getByRole("button", { name: /^Rating/ }).click();
  const panel = page.getByTestId("piece-rating");
  await expect(panel).toContainText("Not rated yet.");
  await panel.getByRole("button", { name: "Rate this piece" }).click();
  await expect(panel.getByRole("status")).toContainText("Waiting for Claude to rate this piece");

  // Only this piece is asked for.
  const listed = await call(client, "list_desk_requests");
  expect(listed.text).toContain(`[piece_id: ${id}]`);
  expect(listed.text).toContain("rate this one piece, and only this one");
  const requestId = listed.text.match(/request_id: ([0-9a-f-]{36})\] \(kind: rate\)/)![1];
  expect(
    (
      await call(client, "set_piece_ratings", {
        ratings: [
          {
            piece_id: id,
            percentile: 63,
            reason: "Clear, but any applicant could say it.",
            sounds_ai: "“rockets near the mountains” reads like a stock line: say which rockets, which mountains.",
          },
        ],
      })
    ).isError,
  ).toBe(false);
  expect((await call(client, "answer_request", { request_id: requestId, answer: "63: name one thing only this college has." })).isError).toBe(false);

  await expect(panel).toContainText("63rd percentile", { timeout: 15_000 });
  // The Files list has it at once, without a reload.
  await expect(page.getByRole("tree", { name: "Colleges and pieces" }).getByTestId("rail-rating")).toHaveText("63");
  await expect(panel).toContainText("rated by Claude");
  // What sounds AI-written gets its own warning, quoted lines and all.
  await expect(panel.getByTestId("rating-ai")).toContainText("Sounds AI-written");
  await expect(panel.getByTestId("rating-ai")).toContainText("“rockets near the mountains” reads like a stock line");
  expect((await call(client, "read_piece", { piece_id: id })).text).toContain("Sounds AI-written: “rockets near the mountains”");
  await expect(panel).toContainText("Clear, but any applicant could say it.");
  await expect(page.getByRole("button", { name: /^Rating 63/ })).toBeVisible();
  await expect(panel.getByTestId("rating-reason")).toContainText("Clear, but any applicant could say it.");
  await expect(panel.getByRole("button", { name: "Rate this piece" })).toBeVisible();
  // The Files list shows it too.
  await page.reload();
  const rail = page.getByRole("tree", { name: "Colleges and pieces" });
  await expect(rail.getByTestId("rail-rating")).toHaveText("63");
  await expect(rail.getByRole("treeitem", { name: /^Why Testy State,.*rated 63, sounds AI-written/ })).toBeVisible();
  await expect(rail.getByTestId("ai-tag")).toBeVisible();
  await page.getByRole("button", { name: /^Rating/ }).click();

  // Edited since: it says so once the text is saved.
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" Also the snow.");
  await waitSaved(page);
  await expect(panel.getByTestId("rating-stale")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("tree", { name: "Colleges and pieces" }).getByTestId("rail-rating")).toHaveAttribute("title", "Rated 63, edited since");
  await client.close();
});
