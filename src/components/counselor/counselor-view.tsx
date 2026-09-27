"use client";

import Link from "next/link";
import { useConnectors } from "@/components/ask/watch-status";
import { DeskThread } from "@/components/thread/desk-thread";
import { CounselorSetup } from "@/app/desk/settings/counselor-setup";
import { counselors, WATCH_PHRASE } from "@/lib/bridge/watchers";

/*
 * The Counselor page: a conversation with the counselor that fills the page, with its model and
 * how hard it thinks in the message box. Setting it up, pausing and removing it are in Settings →
 * Counselor.
 */

const SUGGESTIONS = [
  "What should I work on this week?",
  "Which of my essays needs the most work?",
  "Is my college list balanced?",
  "Help me plan my deadlines.",
];

export function CounselorView({ deskId }: { deskId: string }) {
  const { connectors } = useConnectors(deskId);
  const installed = connectors !== null && counselors(connectors).length > 0;

  return (
    <DeskThread
      deskId={deskId}
      kind="chat"
      also={["interview", "transcript"]}
      startedLabel="You started the profile interview"
      title="Counselor"
      top={connectors !== null && !installed ? <SetupCard /> : null}
      empty={(send, busy) => (
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <h2 className="font-serif text-2xl">Talk to your counselor</h2>
          <p className="text-sm text-muted">
            Your counselor is Claude, on your own Claude plan. Ask anything: what to work on, whether your list is balanced, how to
            start an essay. It can also do things on your desk, like setting up colleges or drafting a piece, within what you allow.
            It remembers what you&apos;ve told it.
          </p>
          <div role="group" aria-label="Ideas" className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                className="rounded-full border border-line bg-panel px-3 py-1.5 text-sm text-muted hover:border-muted hover:text-ink disabled:opacity-50"
                onClick={() => send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      inputLabel="Message your counselor"
      placeholder="Message your counselor…"
      sendLabel="Send"
      clearQuestion="Clear this conversation from the page? Your counselor still remembers it."
      testId="counselor-chat"
    />
  );
}

function SetupCard() {
  return (
    <section className="card flex flex-col gap-3 px-4 py-4" aria-labelledby="counselor-setup-h" data-testid="counselor-setup-card">
      <h2 id="counselor-setup-h" className="font-serif text-xl">
        Set up your counselor
      </h2>
      <p className="text-sm text-muted">
        One download, for Windows or Mac, makes Claude Code on this computer your counselor: it answers everything you ask on your desk,
        hidden, on your own Claude plan (Pro or Max). No Claude Code yet? The setup installs it and has you sign in once. Choose what it may
        do in{" "}
        <Link href="/desk/settings/counselor" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
      <CounselorSetup withPermissions={false} />
      <p className="text-xs text-muted">
        On another kind of computer? Add your connector to a Claude or ChatGPT chat and say &ldquo;{WATCH_PHRASE}&rdquo;: it answers here too.
      </p>
    </section>
  );
}
