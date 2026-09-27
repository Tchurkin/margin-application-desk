import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAC_DIR, MAC_LABEL, MAC_WATCHER_NAME, macInstaller } from "./mac-installer";

/*
 * The Mac counselor end to end: its setup and its watcher, as the student's Mac would run them,
 * against a stand-in desk (the Supabase RPCs and /api/counselor/<token>) and a stand-in Claude
 * Code that speaks just enough stream-json. launchd and dialogs are skipped (AVERAGEAPP_TEST).
 * It runs wherever /usr/bin/perl and /usr/bin/curl are: CI's macOS job, and its Linux one.
 */

const runs =
  process.platform !== "win32" &&
  existsSync("/usr/bin/perl") &&
  existsSync("/usr/bin/curl") &&
  spawnSync("/usr/bin/perl", ["-MJSON::PP", "-MIO::Select", "-e", "1"]).status === 0;

const TOKEN = "example-token-aaaaaaaaaaaa";
const KEY = "example_key";

/** Claude Code, as far as the counselor can tell: its flags, a check run, and stream-json. */
const FAKE_CLAUDE = String.raw`#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use File::Path qw(make_path);
my $J = JSON::PP->new->utf8->canonical;
sub note {
  my ($o) = @_;
  open(my $f, '>>', $ENV{FAKE_CLAUDE_LOG}) or return;
  print {$f} $J->encode($o) . "\n";
  close $f;
}
note({ argv => [@ARGV], pid => $$ });
if (grep { $_ eq '--version' } @ARGV) { print "2.1.999 (Claude Code)\n"; exit 0 }
if (@ARGV >= 2 && $ARGV[0] eq 'project' && $ARGV[1] eq 'purge') { exit 0 }
if (@ARGV >= 2 && $ARGV[0] eq 'auth') {
  my $flag = "$ENV{HOME}/.fake-claude-signed-in";
  if ($ARGV[1] eq 'login') { open(my $f, '>', $flag); close $f; print "Login successful.\n"; exit 0 }
  my $in = !$ENV{FAKE_CLAUDE_SIGNED_OUT} || -e $flag;
  print $J->encode({ loggedIn => $in ? JSON::PP::true : JSON::PP::false, authMethod => $in ? 'claude.ai' : 'none', subscriptionType => $in ? 'pro' : undef }) . "\n";
  exit($in ? 0 : 1);
}
my %o;
for my $i (0 .. $#ARGV - 1) { $o{$1} = $ARGV[$i + 1] if $ARGV[$i] =~ /^--(session-id|resume|model|effort)$/ }
my $session = $o{'session-id'} || $o{resume} || '';
if ($session ne '') {
  my $d = "$ENV{HOME}/.claude/projects/-home-Library-Application-Support-AverageApp-Counselor";
  make_path($d);
  open(my $f, '>>', "$d/$session.jsonl");
  close $f;
}
if (!grep { $_ eq 'stream-json' } @ARGV) { print "Testy's desk\n"; exit 0 }
$| = 1;
my $model = $o{model} || 'sonnet';
sub out { print $J->encode($_[0]) . "\n" }
while (my $line = <STDIN>) {
  my $m = eval { $J->decode($line) };
  next unless ref $m eq 'HASH';
  my $type = $m->{type} || '';
  if ($type eq 'control_request') {
    $model = $m->{request}{model};
    note({ switched => $model });
    out({ type => 'control_response', response => { subtype => 'success', request_id => $m->{request_id} } });
    next;
  }
  next unless $type eq 'user';
  my $text = $m->{message}{content};
  note({ asked => $text, model => $model });
  my $say = $text =~ /Reply with exactly: ([^\n]+)/ ? $1 : 'ok';
  my $reply = "[$model] $say";
  my $pause = $text =~ /\(very slowly\)/ ? 1.5 : $text =~ /\(slowly\)/ ? 0.35 : 0.02;
  out({ type => 'stream_event', event => { type => 'message_start' } });
  for my $part ($reply =~ /(.{1,4})/gs) {
    out({ type => 'stream_event', event => { type => 'content_block_delta', delta => { type => 'text_delta', text => $part } } });
    select(undef, undef, undef, $pause);
  }
  out({ type => 'result', subtype => 'success', is_error => JSON::PP::false, result => $reply, num_turns => 1 });
}
exit 0;
`;

type Req = { id: string; text: string; model?: string; pending: boolean; taken: boolean };
type Event = { fn?: string; fetched?: string[]; args?: Record<string, unknown>; apikey?: string; type?: string };

/** The desk, as the counselor sees it. */
class Desk {
  requests: Req[] = [];
  paused = false;
  remove = false;
  revoked = false;
  events: Event[] = [];
  url = "";
  private server!: Server;

  start() {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const send = (data: unknown, status = 200) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(data));
        };
        const path = req.url ?? "";
        if (path.startsWith("/rest/v1/rpc/")) {
          const fn = path.slice("/rest/v1/rpc/".length);
          const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
          this.events.push({ fn, args, apikey: String(req.headers.apikey ?? ""), type: String(req.headers["content-type"] ?? "") });
          if (this.revoked) return send({ code: "P0001", message: "This connector link is not valid. Make a new one in Average App → Settings." }, 400);
          if (fn === "connector_counselor_poll") {
            let fresh = 0;
            if (!this.paused && !this.remove)
              for (const r of this.requests)
                if (r.pending && !r.taken) {
                  r.taken = true;
                  fresh++;
                }
            const pending = this.requests.filter((r) => r.pending).map((r) => r.id);
            return send({ fresh, waiting: pending.length, speed: "balanced", model: "sonnet", effort: "low", paused: this.paused, remove: this.remove, pending });
          }
          if (fn === "connector_finish_request") {
            const r = this.requests.find((x) => x.id === args.request);
            const ok = !!r?.pending;
            if (r) r.pending = false;
            return send(ok);
          }
          return send(null);
        }
        if (path === `/api/counselor/${TOKEN}`) {
          const out = this.requests.filter((r) => r.pending && r.taken).map((r) => ({ id: r.id, kind: "chat", text: r.text, model: r.model ?? "" }));
          this.events.push({ fetched: out.map((r) => r.id) });
          return send({ requests: out });
        }
        send({ message: "not found" }, 404);
      });
    });
    return new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", () => {
        const a = this.server.address();
        this.url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
        resolve();
      }),
    );
  }
  stop() {
    this.server?.close();
  }
  ask(id: string, message: string, model?: string) {
    this.requests.push({ id, text: `# A request\nThe student's message:\n${message}`, model, pending: true, taken: false });
  }
  calls(fn: string, id?: string) {
    return this.events.filter((e) => e.fn === fn && (id === undefined || e.args?.request === id));
  }
  answer(id: string) {
    return this.calls("connector_finish_request", id)[0]?.args?.answer_text as string | undefined;
  }
}

async function until(what: string, test: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.runIf(runs)("the Mac counselor, with a stand-in desk and Claude Code", () => {
  const desk = new Desk();
  let home = "";
  let dir = "";
  let plist = "";
  let claudeLog = "";
  let env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  let watcher: ChildProcess | null = null;
  let exited: number | null = null;

  const claudeCalls = () =>
    existsSync(claudeLog)
      ? readFileSync(claudeLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { argv?: string[]; asked?: string; model?: string; switched?: string })
      : [];
  const counselorLog = () => (existsSync(join(dir, "counselor.log")) ? readFileSync(join(dir, "counselor.log"), "utf8") : "");

  function install() {
    const script = macInstaller({ site: desk.url, supabaseUrl: desk.url, supabaseKey: KEY, token: TOKEN });
    writeFileSync(join(home, "setup.command"), script);
    return spawnSync("/bin/bash", [join(home, "setup.command")], { env, encoding: "utf8", timeout: 60_000 });
  }
  function startWatcher() {
    exited = null;
    const w = spawn(join(dir, MAC_WATCHER_NAME), [], { cwd: dir, env, stdio: "ignore" });
    w.on("exit", (code) => (exited = code ?? -1));
    watcher = w;
  }

  beforeAll(async () => {
    await desk.start();
    home = mkdtempSync(join(tmpdir(), "mac-counselor-"));
    dir = join(home, MAC_DIR);
    plist = join(home, "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
    claudeLog = join(home, "claude.log");
    const bin = join(home, "fakebin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
    chmodSync(join(bin, "claude"), 0o755);
    env = { NODE_ENV: "test", HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: "en_US.UTF-8", AVERAGEAPP_TEST: "1", FAKE_CLAUDE_LOG: claudeLog };
  });

  afterAll(() => {
    if (watcher && exited === null) watcher.kill("SIGKILL");
    desk.stop();
  });

  it("sets itself up: its folder, its settings, a checked conversation, and a LaunchAgent", () => {
    const r = install();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("Your counselor is on.");
    const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<string, string>;
    expect(config).toMatchObject({ site: desk.url, supabaseUrl: desk.url, key: KEY, token: TOKEN, claude: join(home, "fakebin", "claude") });
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toContain(`${desk.url}/api/mcp/${TOKEN}`);
    expect(readFileSync(join(dir, "headers.txt"), "utf8")).toContain(`apikey: ${KEY}`);
    expect(statSync(join(dir, MAC_WATCHER_NAME)).mode & 0o111).toBeTruthy();
    expect(statSync(join(dir, "Turn off counselor.command")).mode & 0o111).toBeTruthy();
    const session = readFileSync(join(dir, "session.txt"), "utf8").trim();
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    const check = claudeCalls().find((c) => c.argv?.includes("--session-id"));
    expect(check?.argv).toEqual(expect.arrayContaining(["-p", "--session-id", session, "--name", "Average App counselor", "--strict-mcp-config"]));
    const agent = readFileSync(plist, "utf8");
    expect(agent).toContain(`<string>${join(dir, MAC_WATCHER_NAME)}</string>`);
    expect(agent).toContain(`<string>${MAC_LABEL}</string>`);
  });

  it("answers a question, streaming its draft onto the desk as it writes", async () => {
    startWatcher();
    desk.ask("r1", "Reply with exactly: first one done, Café ✓\n(slowly)");
    await until("r1's answer", () => !!desk.answer("r1"));
    expect(desk.answer("r1")).toBe("[sonnet] first one done, Café ✓");
    const drafts = desk.calls("connector_draft_answer", "r1").map((e) => e.args?.draft as string);
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) expect("[sonnet] first one done, Café ✓".startsWith(d)).toBe(true);
    expect(desk.calls("connector_activity", "r1").map((e) => e.args?.tool)).toContain("thinking");
    expect(desk.events.filter((e) => e.fn).every((e) => e.apikey === KEY && e.type === "application/json")).toBe(true);
    const run = claudeCalls().find((c) => c.argv?.includes("stream-json"));
    expect(run?.argv).toEqual(expect.arrayContaining(["--resume", "--model", "sonnet", "--effort", "low", "--allowedTools", "mcp__application-desk"]));
  });

  it("switches the running Claude Code to the model a question asks for", async () => {
    desk.ask("r2", "Reply with exactly: second one done", "haiku");
    await until("r2's answer", () => !!desk.answer("r2"));
    expect(desk.answer("r2")).toBe("[haiku] second one done");
    expect(claudeCalls().some((c) => c.switched === "haiku")).toBe(true);
  });

  it("drops a question the student withdrew before its turn", async () => {
    desk.ask("r3", "Reply with exactly: a slow third one\n(very slowly)");
    await until("r3 to start", () => claudeCalls().some((c) => c.asked?.includes("a slow third one")));
    desk.ask("w1", "Reply with exactly: withdrawn");
    await until("w1 to be fetched", () => desk.events.some((e) => e.fetched?.includes("w1")));
    desk.requests.find((r) => r.id === "w1")!.pending = false;
    await until("r3's answer", () => !!desk.answer("r3"), 40_000);
    await new Promise((r) => setTimeout(r, 3000));
    expect(claudeCalls().some((c) => c.asked?.includes("withdrawn"))).toBe(false);
    expect(counselorLog()).toContain("Dropped a request that was withdrawn.");
  }, 60_000);

  it("waits while paused, then carries on in the same conversation", async () => {
    desk.paused = true;
    await until("Claude Code to rest", () => counselorLog().includes("Claude Code is resting."));
    desk.ask("r4", "Reply with exactly: after the pause");
    await new Promise((r) => setTimeout(r, 4000));
    expect(desk.answer("r4")).toBeUndefined();
    desk.paused = false;
    await until("r4's answer", () => !!desk.answer("r4"));
    const session = readFileSync(join(dir, "session.txt"), "utf8").trim();
    const runs = claudeCalls().filter((c) => c.argv?.includes("stream-json"));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.at(-1)?.argv).toEqual(expect.arrayContaining(["--resume", session]));
  }, 40_000);

  it("removes itself when asked: its conversation, its folder and its LaunchAgent", async () => {
    desk.remove = true;
    await until("the watcher to exit", () => exited !== null);
    expect(exited).toBe(0);
    expect(desk.calls("connector_counselor_removed")).toHaveLength(1);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(plist)).toBe(false);
    expect(claudeCalls().some((c) => c.argv?.[0] === "project" && c.argv?.[1] === "purge")).toBe(true);
    const projects = join(home, ".claude", "projects");
    expect(existsSync(projects) ? readdirSync(projects).filter((d) => d.endsWith("AverageApp-Counselor")) : []).toEqual([]);
  });

  it("turns itself off, keeping its files, when its link is revoked", async () => {
    desk.remove = false;
    const r = install();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    startWatcher();
    await until("the watcher to check in", () => counselorLog().includes("started."));
    desk.revoked = true;
    await until("the watcher to exit", () => exited !== null);
    expect(exited).toBe(0);
    expect(counselorLog()).toContain("Its connector link was revoked");
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(join(dir, "config.json"))).toBe(true);
  });

  // Only on a CI Mac: it loads a real LaunchAgent, which on a developer's Mac could replace their counselor.
  it.runIf(process.platform === "darwin" && process.env.CI === "true")("is started by launchd from its LaunchAgent", async () => {
    const uid = String(process.getuid?.());
    if (spawnSync("/bin/launchctl", ["print", `gui/${uid}`]).status !== 0) return; // No login session to load it into.
    desk.revoked = false;
    rmSync(join(dir, "counselor.log"), { force: true });
    const r = spawnSync("/bin/bash", [join(home, "setup.command")], { env: { ...env, AVERAGEAPP_TEST_LAUNCHD: "1" }, encoding: "utf8", timeout: 60_000 });
    try {
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(spawnSync("/bin/launchctl", ["print", `gui/${uid}/${MAC_LABEL}`]).status).toBe(0);
      await until("launchd to start the watcher", () => counselorLog().includes("started."));
    } finally {
      spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/${MAC_LABEL}`]);
    }
  });
});

describe.runIf(runs)("the Mac setup without Claude Code: it installs it and signs in, with nothing to type", () => {
  const desk = new Desk();
  let home = "";
  let claudeLog = "";
  let env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  const setup = (extra: Record<string, string>) => {
    writeFileSync(join(home, "setup.command"), macInstaller({ site: desk.url, supabaseUrl: desk.url, supabaseKey: KEY, token: TOKEN }));
    return spawnSync("/bin/bash", [join(home, "setup.command")], { env: { ...env, ...extra }, encoding: "utf8", timeout: 60_000 });
  };
  const installed = () => join(home, ".local", "bin", "claude");

  beforeAll(async () => {
    await desk.start();
    home = mkdtempSync(join(tmpdir(), "mac-counselor-new-"));
    claudeLog = join(home, "claude.log");
    // Anthropic's installer, as far as the setup can tell: it puts Claude Code in ~/.local/bin.
    writeFileSync(join(home, "fake-claude"), FAKE_CLAUDE);
    writeFileSync(
      join(home, "install.sh"),
      `mkdir -p "$HOME/.local/bin" && cp "$HOME/fake-claude" "$HOME/.local/bin/claude" && chmod 755 "$HOME/.local/bin/claude" && echo "stand-in installer ran"\n`,
    );
    // No Claude Code anywhere the setup looks, and not signed in.
    env = {
      NODE_ENV: "test",
      HOME: home,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      AVERAGEAPP_TEST: "1",
      AVERAGEAPP_TEST_INSTALLER: join(home, "install.sh"),
      FAKE_CLAUDE_LOG: claudeLog,
      FAKE_CLAUDE_SIGNED_OUT: "1",
    };
  });

  afterAll(() => {
    spawnSync("/usr/bin/pkill", ["-f", join(home, MAC_DIR, "mcp.json")]);
    desk.stop();
  });

  it("asks before installing, and installs nothing when told not now", () => {
    const r = setup({ AVERAGEAPP_TEST_ANSWER: "no" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("it is not on this Mac yet");
    expect(r.stdout).toContain("The counselor needs Claude Code.");
    expect(existsSync(installed())).toBe(false);
  });

  it("installs Claude Code, has you sign in in the browser, then turns the counselor on", () => {
    const r = setup({ AVERAGEAPP_TEST_ANSWER: "yes" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("stand-in installer ran");
    expect(r.stdout).toContain("Opening your browser to sign in to Claude...");
    expect(r.stdout).toContain("Your counselor is on.");
    const calls = readFileSync(claudeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { argv?: string[] }).argv ?? []);
    expect(calls).toContainEqual(["auth", "login", "--claudeai"]);
    const config = JSON.parse(readFileSync(join(home, MAC_DIR, "config.json"), "utf8")) as Record<string, string>;
    expect(config.claude).toBe(installed());
  });

  it("signed in already, it goes straight through", () => {
    const r = setup({ AVERAGEAPP_TEST_ANSWER: "no" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("Opening your browser");
    expect(r.stdout).toContain("Your counselor is on.");
  });
});
