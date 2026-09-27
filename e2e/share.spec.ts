import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addCollege, addPiece, apiClient, essay, expectEssay, expectEssayContains, signUp, suggestLog, waitSaved } from "./helpers";

/** A desk name no other test has. */
const deskName = (tag: string) => `testy-${tag}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The student turns on sharing by desk name and password in Settings. */
async function shareByName(page: Page, opts: { name: string; password: string; role?: "suggest" | "view" | "edit" }) {
  await page.goto("/desk/settings/sharing");
  // By id: "Desk name" also matches the section headed "Desk name and password".
  await page.locator("#share-name").fill(opts.name);
  // Labelled "New password" once sharing is on; blank keeps the password.
  if (opts.password) await page.locator("#share-password").fill(opts.password);
  if (opts.role) await page.getByLabel("People with the password can").selectOption(opts.role);
  await page.getByRole("button", { name: /Turn on sharing|Save/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

/** The student makes a share link in Settings and returns its URL. */
async function makeLink(page: Page, opts: { role: "suggest" | "view" | "edit"; label?: string; password?: string }) {
  const back = page.url();
  // The desk's password covers its links too.
  if (opts.password) await shareByName(page, { name: deskName("link"), password: opts.password });
  await page.goto("/desk/settings/sharing");
  const fold = page.getByTestId("share-links-fold");
  if ((await fold.getAttribute("open")) === null) await fold.locator("summary").click();
  if (opts.label) await page.getByLabel("Who is it for?").fill(opts.label);
  await page.getByLabel("They can").selectOption(opts.role);
  await page.getByRole("button", { name: "Make a share link" }).click();
  const url = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  await page.goto(back);
  return url;
}

/** A parent, in their own browser, opens the link and types their name. */
async function join(browser: Browser, url: string, name: string, password?: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByLabel("Your name").fill(name);
  if (password) await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Open the desk" }).click();
  await expect(page).toHaveURL(/\/shared\//);
  return page;
}

async function openShared(parent: Page, title: string) {
  await parent.getByRole("link", { name: new RegExp(title) }).first().click();
  await expect(essay(parent)).toBeVisible();
}

/** A student with one piece containing `text`. */
async function studentWith(page: Page, tag: string, text: string) {
  await signUp(page, tag);
  await addCollege(page, "Share College");
  await addPiece(page, "Shared essay");
  if (text) {
    await essay(page).click();
    await page.keyboard.insertText(text);
    await waitSaved(page);
  }
}

const suggestions = (p: Page) => p.getByTestId("suggestion");

test("a parent suggests, the student sees it live and accepts it", async ({ page, browser }) => {
  await studentWith(page, "sugg", "The cat sat.");
  const url = await makeLink(page, { role: "suggest", label: "Mom" });
  const mom = await join(browser, url, "Mom");
  await openShared(mom, "Shared essay");
  await expectEssay(mom, "The cat sat.");

  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" Quietly.");
  // Her text is a suggestion, not an edit.
  await expect(mom.locator(".sugg-ins"), await suggestLog(mom)).toHaveText(" Quietly.");

  // The student sees it without reloading, and accepts it.
  await expect(suggestions(page)).toHaveCount(1);
  await expect(suggestions(page)).toContainText("Mom");
  await expect(page.locator(".sugg-ins")).toHaveText(" Quietly.");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "The cat sat. Quietly.");
  await waitSaved(page);
  await expectEssay(mom, "The cat sat. Quietly.");
  await expect(mom.locator(".sugg-ins")).toHaveCount(0);
});

test("replace, delete and decline; the student's text only changes on accept", async ({ page, browser }) => {
  await studentWith(page, "replace", "The cat sat.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Dad");
  await openShared(mom, "Shared essay");
  await essay(mom).click();

  // Select "cat" and type "dog".
  await mom.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await mom.keyboard.press("ArrowRight");
  for (let i = 0; i < 3; i++) await mom.keyboard.press("Shift+ArrowRight");
  await mom.keyboard.type("dog");
  // Backspace "sat" at the end (three presses make one suggestion).
  await mom.keyboard.press("Control+End");
  await mom.keyboard.press("ArrowLeft");
  for (let i = 0; i < 3; i++) await mom.keyboard.press("Backspace");

  await expect(suggestions(page)).toHaveCount(2);
  await expect(suggestions(page).nth(0)).toContainText("Replace “cat” with “dog”");
  await expect(suggestions(page).nth(1), await suggestLog(mom)).toContainText("Delete “sat”");
  await expectEssay(page, "The cat sat.");

  await suggestions(page).nth(0).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "The dog sat.");
  await suggestions(page).nth(0).getByRole("button", { name: "Decline" }).click();
  await expect(suggestions(page)).toHaveCount(0);
  await expectEssay(page, "The dog sat.");
  // Undo the decline: it comes back.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(suggestions(page)).toHaveCount(1);
});

test("suggesting into an empty piece, then accepting it", async ({ page, browser }) => {
  await studentWith(page, "emptysugg", "");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.type("Start here");
  await expect(mom.locator(".sugg-ins")).toHaveText("Start here");
  await expect(suggestions(page)).toHaveCount(1);
  await expect(page.locator(".sugg-ins")).toHaveText("Start here");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "Start here");
  await waitSaved(page);
  await page.reload();
  await expectEssay(page, "Start here");
});

test("suggesting while the student types elsewhere: the suggestion stays whole", async ({ page, browser }) => {
  await studentWith(page, "busy", "One. Two.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await mom.keyboard.press("ArrowRight"); // after "One."

  await essay(page).click();
  await page.keyboard.press("Control+End");
  const typing = (async () => {
    for (const ch of " Three. Four. Five.") {
      await page.keyboard.type(ch);
      await page.waitForTimeout(40);
    }
  })();
  for (const ch of " Really.") {
    await mom.keyboard.type(ch);
    await mom.waitForTimeout(55);
  }
  await typing;
  await waitSaved(page);
  await expect(mom.locator(".sugg-ins")).toHaveText(" Really.");
  await expectEssayContains(page, "One. Two. Three. Four. Five.");
  await expectEssayContains(mom, "Three. Four. Five.");
  await expect(suggestions(page)).toHaveCount(1);
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "One. Really. Two. Three. Four. Five.");
});

test("a suggestion made just before leaving or reloading is kept, and Ctrl+Z undoes a burst", async ({ page, browser }) => {
  await studentWith(page, "sugreload", "Hello.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" World");
  await mom.reload(); // no waiting
  await expect(essay(mom)).toBeVisible();
  await expect(mom.locator(".sugg-ins")).toHaveText(" World");
  await expect(suggestions(page)).toHaveCount(1);

  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.waitForTimeout(1200);
  await mom.keyboard.type(" again");
  await expect(mom.locator(".sugg-ins")).toHaveText(" World again");
  await mom.keyboard.press("Control+z");
  await expect(mom.locator(".sugg-ins")).toHaveText(" World");
  await expect(page.locator(".sugg-ins")).toHaveText(" World");
});

test("people it's shared with have the Board, Write and Strategy, and nothing of the student's own", async ({ page, browser }) => {
  await studentWith(page, "pages", "Hello from Testy.");
  const guest = await join(browser, await makeLink(page, { role: "view" }), "Dad");
  const nav = guest.getByRole("navigation", { name: "Desk" });
  for (const name of ["Board", "Write", "Strategy"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  for (const name of ["Profile", "Counselor", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);

  // Write opens the piece to work on, in the workspace: the rail, the history, and the essay's Ask chat.
  await nav.getByRole("link", { name: "Write", exact: true }).click();
  await expect(guest).toHaveURL(/\/shared\/[^/]+\/piece\//);
  await expectEssay(guest, "Hello from Testy.");
  const tools = guest.getByRole("toolbar", { name: "Tools" });
  await expect(tools.getByRole("button", { name: "Files" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "History" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Ask" })).toBeVisible();
  await expect(guest.getByRole("button", { name: /Delete “/ })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /Add a piece/ })).toHaveCount(0);
  // The Files panel starts open: the rail, and tabs that stay on the shared desk.
  await expect(guest.getByRole("tree", { name: "Colleges and pieces" }).getByRole("treeitem", { name: /Shared essay/ })).toBeVisible();
  await expect(guest.getByRole("tab", { name: /Shared essay/ })).toHaveAttribute("href", /\/shared\/[^/]+\/piece\//);

  // Strategy, to read: the colleges in bands, without the student's academics or their requests.
  await nav.getByRole("link", { name: "Strategy", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Strategy", level: 1 })).toBeVisible();
  await expect(guest.getByRole("cell", { name: "Share College" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Share College" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  await expect(guest.getByText("Academic profile")).toHaveCount(0);
  await expect(guest.getByText("Estimate your odds")).toHaveCount(0);

  await nav.getByRole("link", { name: "Board", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();
});

test("the Files panel shows where everyone on the desk is", async ({ page, browser }) => {
  await studentWith(page, "presence", "Where is everyone?");
  await page.goto((await page.getByRole("link", { name: "Share College", exact: true }).first().getAttribute("href"))!);
  await addPiece(page, "Second essay");
  const mom = await join(browser, await makeLink(page, { role: "suggest", label: "Mom" }), "Mom Testy");
  await openShared(mom, "Shared essay");

  // The student is on "Second essay"; Mom has "Shared essay" open.
  const rail = page.getByRole("tree", { name: "Colleges and pieces" });
  await expect(rail.getByRole("treeitem", { name: /^Shared essay,.*Mom Testy is here/ })).toBeVisible({ timeout: 15_000 });
  await expect(rail.getByRole("treeitem", { name: /^Second essay,/ })).not.toHaveAccessibleName(/is here/);

  // She moves to the student's piece, and the faces follow her.
  const sharedDesk = new URL(mom.url()).pathname.split("/piece/")[0];
  await mom.goto(`${sharedDesk}/piece/${page.url().split("/piece/")[1]}`);
  await expect(rail.getByRole("treeitem", { name: /^Second essay,.*Mom Testy is here/ })).toBeVisible({ timeout: 15_000 });
  await expect(rail.getByRole("treeitem", { name: /^Shared essay,/ })).not.toHaveAccessibleName(/is here/);

  // And she's gone when she closes the desk.
  await mom.close();
  await expect(rail.getByRole("treeitem", { name: /^Second essay,/ })).not.toHaveAccessibleName(/is here/, { timeout: 20_000 });
});

test("people the desk is shared with see the essay's Ask chat, and ask in it while the counselor is on", async ({ page, browser, request }) => {
  await studentWith(page, "askshare", "My essay about robots.");
  const pieceUrl = page.url();
  // The student's counselor: a connector link that checks in the way the counselor on their computer does.
  await page.goto("/desk/settings/connectors");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const link = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  const token = link.split("/api/mcp/")[1];
  const api = apiClient();
  // Something only the student's profile holds, which a guest's question must never carry.
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  const saved = (await client.callTool({ name: "update_my_profile", arguments: { about: "Testy's private note: SECRET-ABOUT-TESTY" } })) as { isError?: boolean };
  expect(saved.isError).toBeFalsy();
  await client.close();
  const checkIn = async () => {
    const { data, error } = await api.rpc("connector_counselor_poll", { token, version: "5", computer: "TESTY-PC", machine: "e2e-askshare" });
    if (error) throw new Error(error.message);
    return data as { fresh: number };
  };

  const mom = await join(browser, await makeLink(page, { role: "suggest", label: "Mom" }), "Mom Testy");
  await openShared(mom, "Shared essay");
  const tools = mom.getByRole("toolbar", { name: "Tools" });
  await tools.getByRole("button", { name: "Ask" }).click();
  const panel = mom.getByTestId("shared-ask-panel");
  // Off: she can read, not ask.
  await expect(panel.getByTestId("counselor-on")).toHaveText("The student's counselor is off right now.");
  await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();

  // On (the panel looks again every 15 seconds): she asks, as herself.
  await checkIn();
  await expect(panel.getByTestId("counselor-on")).toHaveText("The student's counselor is on.", { timeout: 25_000 });
  await panel.getByLabel("Ask about this piece").fill("Is the ending too abrupt?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByTestId("request")).toHaveCount(1);
  await expect(panel.getByTestId("asked-by")).toContainText("Mom Testy");

  // The counselor takes it, is told who asked, and answers it on its own from just the essay; both of them see it.
  await expect.poll(async () => (await checkIn()).fresh).toBe(1);
  const work = (await (await request.get(`/api/counselor/${token}`)).json()) as { requests: { id: string; text: string; guest?: boolean }[] };
  expect(work.requests[0].guest).toBe(true);
  expect(work.requests[0].text).toContain("Mom Testy, someone the student shares their desk with");
  expect(work.requests[0].text).toContain("My essay about robots.");
  expect(work.requests[0].text).not.toContain("SECRET-ABOUT-TESTY");
  expect((await api.rpc("connector_finish_request", { token, request: work.requests[0].id, answer_text: "It lands, but add one more beat." })).data).toBe(true);
  await expect(panel).toContainText("It lands, but add one more beat.");
  await page.goto(pieceUrl);
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Ask" }).click();
  const mine = page.getByTestId("ask-panel");
  await expect(mine.getByTestId("asked-by")).toContainText("Mom Testy");
  await expect(mine).toContainText("It lands, but add one more beat.");

  // Someone who can only read follows along.
  const grandpa = await join(browser, await makeLink(page, { role: "view", label: "Grandpa" }), "Grandpa");
  await openShared(grandpa, "Shared essay");
  await grandpa.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Ask" }).click();
  await expect(grandpa.getByTestId("shared-ask-panel")).toContainText("It lands, but add one more beat.");
  await expect(grandpa.getByTestId("shared-ask-panel")).toContainText("You can read along here.");
});

test("read-only links can't change anything", async ({ page, browser }) => {
  await studentWith(page, "viewonly", "Read me.");
  const reader = await join(browser, await makeLink(page, { role: "view" }), "Grandpa");
  await openShared(reader, "Shared essay");
  await expectEssay(reader, "Read me.");
  await essay(reader).click();
  await reader.keyboard.type("scribble");
  await reader.keyboard.press("Backspace");
  await expectEssay(reader, "Read me.");
  await expect(reader.locator(".sugg-ins")).toHaveCount(0);
  await page.reload();
  await expectEssay(page, "Read me.");
  await expect(suggestions(page)).toHaveCount(0);
});

test("anyone with the desk's name and password opens it from the home page; the student decides what they can do", async ({ page, browser }) => {
  await studentWith(page, "byname", "Hello there.");
  const name = deskName("byname");
  await shareByName(page, { name, password: "open-sesame-9", role: "view" });

  const ctx = await browser.newContext();
  const mom = await ctx.newPage();
  await mom.goto("/");
  const box = mom.getByRole("form", { name: "Open a desk" });
  const open = async (deskNameTyped: string, password: string) => {
    await box.getByLabel("Desk name").fill(deskNameTyped);
    await box.getByLabel("Password").fill(password);
    await box.getByLabel("Your name").fill("Mom");
    await box.getByRole("button", { name: "Open the desk" }).click();
  };
  // A wrong password and a name that doesn't exist get the same answer.
  await open(name, "not-the-password");
  await expect(box.getByRole("alert")).toHaveText("That desk name and password don't match.");
  await open(`${name}-nope`, "open-sesame-9");
  await expect(box.getByRole("alert")).toHaveText("That desk name and password don't match.");
  // The name isn't fussy about capitals.
  await open(name.toUpperCase(), "open-sesame-9");
  await expect(mom).toHaveURL(/\/shared\//);
  await expect(mom.getByRole("banner")).toContainText("Mom · read only");
  const deskUrl = mom.url();

  // What people with the password can do is one setting: suggesting, now.
  await shareByName(page, { name, password: "", role: "suggest" });
  await mom.reload();
  await expect(mom.getByRole("banner")).toContainText("Mom · can suggest");

  // The student sees who came in, and can take one person off.
  await page.goto("/desk/settings/sharing");
  const people = page.getByRole("list", { name: "People who have joined" });
  await expect(people).toContainText("Mom");
  await expect(people).toContainText("with the password");
  await people.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Nobody yet.")).toBeVisible();
  expect((await mom.goto(deskUrl))?.status()).toBe(404);

  // Back in with the password, then sharing is turned off: out again, and the password no longer works.
  await mom.goto("/?open");
  await open(name, "open-sesame-9");
  await expect(mom).toHaveURL(/\/shared\//);
  await page.goto("/desk/settings/sharing");
  await page.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: "Turn on sharing" })).toBeVisible();
  expect((await mom.goto(deskUrl))?.status()).toBe(404);
  await mom.goto("/?open");
  await open(name, "open-sesame-9");
  await expect(box.getByRole("alert")).toHaveText("That desk name and password don't match.");

  // On again, with a new password: whoever was in before isn't let back in by it.
  await shareByName(page, { name, password: "brand-new-pass-7", role: "suggest" });
  expect((await mom.goto(deskUrl))?.status()).toBe(404);
  await ctx.close();
});

test("passwords are checked, and revoking a link cuts access", async ({ page, browser }) => {
  await studentWith(page, "revoke", "Private.");
  const url = await makeLink(page, { role: "suggest", label: "Coach", password: "sesame-42" });

  const ctx = await browser.newContext();
  const wrong = await ctx.newPage();
  await wrong.goto(url);
  await wrong.getByLabel("Your name").fill("Coach");
  await wrong.getByLabel("Password").fill("nope-nope");
  await wrong.getByRole("button", { name: "Open the desk" }).click();
  await expect(wrong.getByText("Wrong password.")).toBeVisible();

  const coach = await join(browser, url, "Coach", "sesame-42");
  const deskUrl = coach.url();
  await openShared(coach, "Shared essay");
  const pieceUrl = coach.url();

  await page.goto("/desk/settings/sharing");
  const links = page.getByRole("list", { name: "Share links" });
  await expect(links).toContainText("Joined: Coach");
  await links.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(links).toHaveCount(0);

  for (const u of [deskUrl, pieceUrl]) {
    const res = await coach.goto(u);
    expect(res?.status()).toBe(404);
  }
  await coach.goto(url);
  await expect(coach.getByText("This link doesn't work")).toBeVisible();
});

test("a suggester can't write the text, change a piece's settings or resolve suggestions; an editor's bad edit can't break the piece", async ({
  page,
}) => {
  await studentWith(page, "direct", "Mine.");
  const url = await makeLink(page, { role: "suggest" });
  const editUrl = await makeLink(page, { role: "edit" });
  const token = url.split("/join/")[1];
  const pieceId = page.url().split("/").pop()!;
  await page.goto(`/desk/piece/${pieceId}`);

  const api = apiClient();
  const { error: e1 } = await api.auth.signInAnonymously();
  expect(e1).toBeNull();
  const { data: joined } = await api.rpc("join_desk", { token, link_password: "", name: "Sneaky" });
  expect((joined as { ok: boolean }).ok).toBe(true);

  // Can read the piece...
  const { data: rows } = await api.from("pieces").select("id").eq("id", pieceId);
  expect(rows).toHaveLength(1);
  // ...but can't write its text...
  const { error: w1 } = await api.from("piece_updates").insert({ piece_id: pieceId, client_id: "x", update: "AAA=" });
  expect(w1).not.toBeNull();
  // ...change its fields or resolve suggestions.
  const { data: upd } = await api.from("pieces").update({ title: "hacked" }).eq("id", pieceId).select("id");
  expect(upd ?? []).toHaveLength(0);
  const sid = crypto.randomUUID();
  const { error: w2 } = await api.from("suggestions").insert({
    id: sid,
    piece_id: pieceId,
    author_name: "Sneaky",
    kind: "insert",
    anchor_from: "AA==",
    body: "x",
  });
  expect(w2).toBeNull();
  const { error: w3 } = await api.from("suggestions").update({ status: "accepted" }).eq("id", sid);
  expect(w3).not.toBeNull();
  // And can't pose as someone else.
  const { error: w4 } = await api.from("suggestions").insert({
    id: crypto.randomUUID(),
    piece_id: pieceId,
    author_id: "00000000-0000-0000-0000-000000000000",
    kind: "insert",
    anchor_from: "AA==",
  });
  expect(w4).not.toBeNull();

  // Someone on an edit link writes the text directly; a malformed edit is skipped, not fatal.
  const editor = apiClient();
  expect((await editor.auth.signInAnonymously()).error).toBeNull();
  const { data: joinedEdit } = await editor.rpc("join_desk", { token: editUrl.split("/join/")[1], link_password: "", name: "Editor" });
  expect((joinedEdit as { ok: boolean }).ok).toBe(true);
  const { error: w5 } = await editor.from("piece_updates").insert({ piece_id: pieceId, client_id: "y", update: "AAA=" });
  expect(w5).toBeNull();

  await page.reload();
  await expectEssay(page, "Mine.");
});

test("two tabs of the student edit live", async ({ page, context }) => {
  await studentWith(page, "twotabs", "Start.");
  const other = await context.newPage();
  await other.goto(page.url());
  await expectEssay(other, "Start.");
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" From one.");
  await essay(other).click();
  await other.keyboard.press("Control+Home");
  await other.keyboard.type("Two says hi. ");
  await expectEssay(page, "Two says hi. Start. From one.");
  await expectEssay(other, "Two says hi. Start. From one.");
  // Each sees the other's caret.
  await expect(page.locator(".collaboration-carets__label")).toHaveCount(1);
});

test("people who can edit switch between Editing and Suggesting, suggesters only suggest, and the student can suggest too", async ({
  page,
  browser,
}) => {
  await studentWith(page, "modes", "Start.");
  const dad = await join(browser, await makeLink(page, { role: "suggest", label: "Dad" }), "Dad");
  await openShared(dad, "Shared essay");
  await expect(dad.getByText("Your changes show as suggestions")).toBeVisible();
  await expect(dad.getByRole("radiogroup", { name: "Mode" })).toHaveCount(0);

  const mom = await join(browser, await makeLink(page, { role: "edit" }), "Mom");
  await openShared(mom, "Shared essay");

  // Mom starts in Suggesting; in Editing her words go straight into the text.
  await expect(mom.getByRole("radio", { name: "Suggesting" })).toHaveAttribute("aria-checked", "true");
  await mom.getByRole("radio", { name: "Editing" }).click();
  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" Mom was here.");
  await expectEssay(page, "Start. Mom was here.");
  await expect(suggestions(page)).toHaveCount(0);

  // The student switches to Suggesting, suggests, and accepts their own suggestion.
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Maybe.");
  await expect(suggestions(page)).toHaveCount(1);
  await expectEssay(page, "Start. Mom was here.");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "Start. Mom was here. Maybe.");
  await expectEssay(mom, "Start. Mom was here. Maybe.");

  // The student lets Dad edit too: his link changes for him at once.
  await page.goto("/desk/settings/sharing");
  await page.getByRole("list", { name: "Share links" }).getByLabel("What Dad can do").selectOption("edit");
  await expect(async () => {
    await dad.reload();
    await expect(dad.getByRole("radiogroup", { name: "Mode" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
});
