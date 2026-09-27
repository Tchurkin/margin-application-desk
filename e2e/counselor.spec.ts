import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { COUNSELOR_VERSION } from "../src/lib/counselor/version";
import { addCollege, addPiece, adminClient, apiClient, signUp, studentClient } from "./helpers";

/*
 * The Counselor page and Settings → Counselor, driven the way the counselor on a student's
 * computer drives the desk: the same database calls its watcher makes (poll, draft, finish,
 * activity, removed) and the same work endpoint, so no real Claude is needed.
 */

async function makeConnector(page: Page) {
  const back = page.url();
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const url = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  await page.goto(back);
  return url;
}

async function connect(url: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

type Poll = { fresh: number; waiting: number; speed: string; model: string; effort: string; paused: boolean; remove: boolean };

function counselorApi(token: string) {
  const api = apiClient();
  return {
    poll: async (version = COUNSELOR_VERSION) => {
      const { data, error } = await api.rpc("connector_counselor_poll", { token, version });
      if (error) throw new Error(error.message);
      return data as Poll;
    },
    rpc: (fn: string, args: Record<string, unknown>) => api.rpc(fn, { token, ...args }),
  };
}

const SETTINGS = "/desk/settings/counselor";
const chat = (p: Page) => p.getByTestId("counselor-chat");
const card = (p: Page) => p.getByTestId("counselor-card");

test("talking to the counselor: live drafts, models, pause, and removing it from the computer", async ({ page, request }) => {
  await signUp(page, "counselor");
  await page.goto("/desk/counselor");
  await expect(page.getByTestId("counselor-setup-card")).toContainText("Set up your counselor");

  // A message waits on the desk until someone picks it up.
  await chat(page).getByRole("button", { name: "What should I work on this week?" }).click();
  await expect(chat(page)).toContainText("Waiting for Claude");

  const token = (await makeConnector(page)).split("/api/mcp/")[1];
  const c = counselorApi(token);

  // An older counselor shows up in Settings with an update on offer.
  expect(await c.poll("1")).toMatchObject({ fresh: 1, waiting: 1, speed: "balanced", model: "sonnet", effort: "medium", paused: false, remove: false });
  await page.goto(SETTINGS);
  await expect(card(page).getByTestId("counselor-update")).toBeVisible();
  expect((await c.poll()).fresh).toBe(0);
  await page.reload();
  await expect(card(page).getByTestId("counselor-update")).toHaveCount(0);
  await expect(card(page).getByTestId("counselor-state")).toContainText("On");
  await page.goto("/desk/counselor");
  await expect(page.getByTestId("counselor-setup-card")).toHaveCount(0);
  await expect(chat(page)).toContainText("Your counselor has it");

  // Its work comes with everything needed to answer by replying.
  const work = await request.get(`/api/counselor/${token}`);
  expect(work.ok()).toBe(true);
  const { requests } = (await work.json()) as { requests: { id: string; kind: string; text: string }[] };
  expect(requests).toHaveLength(1);
  expect(requests[0].kind).toBe("chat");
  expect(requests[0].text).toContain("What should I work on this week?");
  expect(requests[0].text).toContain("don't call answer_request");
  const id = requests[0].id;

  // What it's doing, then the answer as it's written, then the answer.
  await c.rpc("connector_activity", { tool: "thinking", request: id });
  await expect(chat(page)).toContainText("Your counselor is thinking", { timeout: 20_000 });
  await c.rpc("connector_draft_answer", { request: id, draft: "Start with **Why Northfield**" });
  await expect(chat(page).getByTestId("draft-answer")).toContainText("Start with Why Northfield");
  const { data: finished } = await c.rpc("connector_finish_request", { request: id, answer_text: "Start with **Why Northfield**, then the Community essay." });
  expect(finished).toBe(true);
  await expect(chat(page).locator("strong", { hasText: "Why Northfield" })).toBeVisible();
  await expect(chat(page)).not.toContainText("writing…");
  const { data: again } = await c.rpc("connector_finish_request", { request: id, answer_text: "Again." });
  expect(again).toBe(false);

  // The counselor's model and how hard it thinks, from the message box.
  await chat(page).getByLabel("Model").selectOption("opus");
  await expect.poll(async () => (await c.poll()).model).toBe("opus");
  await chat(page).getByLabel("Thinking").selectOption("high");
  await expect.poll(async () => (await c.poll()).effort).toBe("high");
  expect((await c.poll()).speed).toBe("thorough");
  await page.reload();
  await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
  await expect(chat(page).getByLabel("Thinking")).toHaveValue("high");

  // Paused in Settings, it picks nothing up; resumed, it does.
  await page.goto(SETTINGS);
  await card(page).getByRole("button", { name: "Pause" }).click();
  await expect.poll(async () => (await c.poll()).paused).toBe(true);
  await page.goto("/desk/counselor");
  await expect(chat(page).getByTestId("watch-status")).toContainText("paused");
  // A question goes with the model picked for it.
  await chat(page).getByLabel("Model").selectOption("haiku");
  await expect.poll(async () => (await c.poll()).model).toBe("haiku");
  await chat(page).getByLabel("Message your counselor").fill("Is my list balanced?");
  await chat(page).getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat(page)).toContainText("Is my list balanced?");
  expect(await c.poll()).toMatchObject({ fresh: 0, waiting: 1, paused: true });
  await page.goto(SETTINGS);
  await expect(card(page).getByTestId("counselor-state")).toContainText("Paused");
  await card(page).getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await c.poll()).fresh).toBe(1);
  const later = (await (await request.get(`/api/counselor/${token}`)).json()) as { requests: { text: string; model: string }[] };
  expect(later.requests.find((r) => r.text.includes("Is my list balanced?"))?.model).toBe("haiku");

  // Removing it from the computer: it's asked to, does, and its link is gone.
  await card(page).getByRole("button", { name: "Remove from computer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(card(page).getByTestId("counselor-removing")).toBeVisible();
  expect(await c.poll()).toMatchObject({ remove: true, fresh: 0 });
  expect((await c.rpc("connector_counselor_removed", {})).error).toBeNull();
  await page.reload();
  await expect(page.getByTestId("counselor-setup")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(c.poll()).rejects.toThrow(/not valid/);
});

test.describe("on a Windows computer", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("updating an older counselor: the old one answers until the new one starts, with the same settings", async ({ page }) => {
    await signUp(page, "counselorupdate");
    const token = (await makeConnector(page)).split("/api/mcp/")[1];
    const old = counselorApi(token);
    await old.poll("1");
    await page.goto("/desk/counselor");
    await chat(page).getByLabel("Model").selectOption("haiku");
    await expect.poll(async () => (await old.poll("1")).model).toBe("haiku");
    await page.goto(SETTINGS);

    const [download] = await Promise.all([page.waitForEvent("download"), card(page).getByRole("button", { name: "Update the counselor" }).click()]);
    expect(download.suggestedFilename()).toBe("Average App counselor setup.cmd");
    await expect(card(page).getByTestId("counselor-update-pending")).toBeVisible();
    await expect(page.getByTestId("counselor-steps")).toBeVisible();
    const file = readFileSync((await download.path())!, "utf8");
    const fresh = file.match(/\$Token = '([A-Za-z0-9_-]+)'/)![1];
    expect(fresh).not.toBe(token);

    // Until the new counselor runs, the old one keeps working.
    expect((await old.poll("1")).model).toBe("haiku");
    // The setup on its computer stops the old one. Once that one has gone quiet (it never said which
    // computer it's on, so a counselor still checking in would be another computer's), the new
    // one's check-in turns it off.
    const ago = new Date(Date.now() - 60_000).toISOString();
    await adminClient()
      .from("connector_links")
      .update({ counselor_at: ago, last_used_at: ago, activity_at: null })
      .eq("token_hash", createHash("sha256").update(token).digest("hex"));
    expect(await counselorApi(fresh).poll()).toMatchObject({ model: "haiku", paused: false });
    await expect(old.poll("1")).rejects.toThrow(/not valid/);
    await page.reload();
    await expect(card(page).getByTestId("counselor-state")).toContainText("On");
    await expect(card(page).getByTestId("counselor-update")).toHaveCount(0);
    await expect(card(page).getByTestId("counselor-update-pending")).toHaveCount(0);
  });
});

test.describe("on a Mac", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" });

  test("the counselor sets up from one line in Terminal (nothing downloaded for macOS to hold back)", async ({ page, request }) => {
    await signUp(page, "maccounselor");
    await page.goto(SETTINGS);
    // Once the setup is on the page: only the Mac's way is offered.
    const mac = page.getByRole("button", { name: "Set up the counselor on this Mac" });
    await expect(mac).toBeVisible();
    await expect(page.getByRole("button", { name: "Download the counselor for Windows" })).toHaveCount(0);
    await mac.click();
    const steps = page.getByTestId("counselor-steps");
    await expect(steps).toContainText("Open Terminal");
    await expect(steps).not.toContainText("Open Anyway");
    const line = await steps.getByLabel("Setup line").inputValue();
    // bash -c, so what the setup asks (signing in) reads the keyboard, not the script.
    const url = line.match(/^\/bin\/bash -c "\$\(curl -fsSL '([^']+)'\)"$/)![1];
    expect(url).toMatch(/\/api\/counselor\/[A-Za-z0-9_-]+\/setup$/);
    const script = await (await request.get(url)).text();
    expect(script.startsWith("#!/bin/bash\n")).toBe(true);
    // The link inside is a live counselor link: the watcher's first check-in works.
    const token = script.match(/^TOKEN='([A-Za-z0-9_-]+)'$/m)![1];
    expect(url).toContain(token);
    expect(await counselorApi(token).poll()).toMatchObject({ fresh: 0, paused: false, remove: false });
    // A made-up link gets a plain message, not a setup.
    // A bad line says so in Terminal (curl -f would drop an error's text).
    const bad = await request.get(url.replace(token, "not a token"));
    expect(bad.status()).toBe(200);
    expect(await bad.text()).toContain("This setup line is not valid");
  });
});

test("the desk shows what an assistant is doing through the connector", async ({ page }) => {
  await signUp(page, "counselordoing");
  await addCollege(page, "Doing College");
  const pieceId = await addPiece(page, "Why us");
  const url = await makeConnector(page);
  const client = await connect(url);
  // The counselor checks in, then reads the piece.
  await counselorApi(url.split("/api/mcp/")[1]).poll();
  await client.callTool({ name: "read_piece", arguments: { piece_id: pieceId } });
  await page.goto(`/desk/piece/${pieceId}`);
  if (!(await page.getByTestId("ask-panel").isVisible())) await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("watch-status")).toContainText("Your counselor is reading “Why us”");
  await client.close();
});

test("an answer that arrives on another page lights up its tab and says where it is", async ({ page }) => {
  const student = await signUp(page, "notice");
  await page.goto("/desk/counselor");
  await chat(page).getByLabel("Message your counselor").fill("Is my list balanced?");
  await chat(page).getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat(page)).toContainText("Is my list balanced?");

  // Off on the board when the answer comes in.
  await page.goto("/desk");
  await expect(page.getByTestId("desk-notices")).toHaveAttribute("data-ready", "true");
  const api = await studentClient(student);
  const { data: answered } = await api
    .from("desk_requests")
    .update({ status: "answered", answer: "Yes, it's **balanced**.", answered_by: "Claude", answered_at: new Date().toISOString() })
    .eq("kind", "chat")
    .eq("status", "pending")
    .select("id");
  expect(answered).toHaveLength(1);

  const note = page.getByRole("status").filter({ hasText: "Claude replied on the Counselor page." });
  // Realtime, or the backstop poll if the update beat the subscription.
  await expect(note).toBeVisible({ timeout: 15_000 });
  const tab = page.getByRole("navigation", { name: "Desk" }).getByRole("link", { name: /^Counselor/ });
  await expect(tab).toHaveAccessibleName("Counselor (new reply)");
  await page.reload();
  await expect(tab).toHaveAccessibleName("Counselor (new reply)");

  await tab.click();
  await expect(page).toHaveURL(/\/desk\/counselor$/);
  await expect(chat(page)).toContainText("Yes, it's balanced.");
  await expect(tab).toHaveAccessibleName("Counselor");
  // Read: back on the board, the dot stays gone.
  await page.goto("/desk");
  await expect(page.getByTestId("desk-notices")).toHaveAttribute("data-ready", "true");
  await expect(tab).toHaveAccessibleName("Counselor");
});

test("the counselor on two computers: each question goes to one of them, and Settings lists both", async ({ page, request }) => {
  await signUp(page, "twopcs");
  const tokenOne = (await makeConnector(page)).split("/api/mcp/")[1];
  const tokenTwo = (await makeConnector(page)).split("/api/mcp/")[1];
  const one = counselorApi(tokenOne);
  const two = counselorApi(tokenTwo);
  // Each checks in saying which computer it's on (a name, and a hashed id).
  const checkIn = async (c: ReturnType<typeof counselorApi>, version: string, computer: string, machine: string) => {
    const { data, error } = await c.rpc("connector_counselor_poll", { version, computer, machine });
    if (error) throw new Error(error.message);
    return data as Poll & { pending: string[] };
  };
  await checkIn(one, COUNSELOR_VERSION, "TESTY-DESKTOP", "e2e-machine-one");
  await checkIn(two, `${COUNSELOR_VERSION}-mac`, "Testy's MacBook", "e2e-machine-two");

  await page.goto("/desk/counselor");
  await chat(page).getByRole("button", { name: "What should I work on this week?" }).click();
  await expect(chat(page)).toContainText("What should I work on this week?");

  // The first to check in takes it (once it's on the desk); the other never sees it.
  await expect.poll(async () => (await checkIn(one, COUNSELOR_VERSION, "TESTY-DESKTOP", "e2e-machine-one")).fresh).toBe(1);
  const second = await checkIn(two, `${COUNSELOR_VERSION}-mac`, "Testy's MacBook", "e2e-machine-two");
  expect(second).toMatchObject({ fresh: 0, waiting: 0, pending: [] });
  const workOne = (await (await request.get(`/api/counselor/${tokenOne}`)).json()) as { requests: { id: string }[] };
  const workTwo = (await (await request.get(`/api/counselor/${tokenTwo}`)).json()) as { requests: { id: string }[] };
  expect(workOne.requests).toHaveLength(1);
  expect(workTwo.requests).toHaveLength(0);
  // Only the one holding it can answer.
  const id = workOne.requests[0].id;
  expect((await two.rpc("connector_finish_request", { request: id, answer_text: "From the Mac." })).data).toBe(false);
  expect((await one.rpc("connector_finish_request", { request: id, answer_text: "From the desktop." })).data).toBe(true);
  await expect(chat(page)).toContainText("From the desktop.");
  await expect(chat(page)).not.toContainText("From the Mac.");

  // Settings lists each computer by its name, and offers to add another.
  await page.goto(SETTINGS);
  await expect(card(page)).toHaveCount(2);
  await expect(page.getByRole("region", { name: "TESTY-DESKTOP" })).toContainText("Windows · version");
  await expect(page.getByRole("region", { name: "Testy's MacBook" })).toContainText("Mac · version");
  await expect(page.getByTestId("counselor-add").getByText("Add it to another computer")).toBeVisible();
});
