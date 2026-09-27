"use client";

import Link from "next/link";
import { useState } from "react";
import { counselorPlatform, isOutdated, useConnectors } from "@/components/ask/watch-status";
import { ConfirmButton } from "@/components/confirm-button";
import { revokeConnectorLink, setCounselorPaused, setCounselorRemove, updateCounselorLink } from "@/app/desk/connector-actions";
import { timeOf, whenLabel } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import { activityText, counselors, isCounselor, pendingReplacement, type Connector } from "@/lib/bridge/watchers";
import { downloadInstaller } from "@/lib/counselor/download";
import { asEssayAccess } from "@/lib/domain/share";
import { ConnectorPermissions } from "../connector-creator";
import { CounselorSetup, InstallSteps, usePlatform } from "../counselor-setup";

/*
 * Settings → Counselor: set it up, or, for each computer it runs on, see whether it's on and
 * change what it may do, update it, pause it or remove it; and add it to another computer. Each
 * question goes to one of them (team request 22). Talking to it, and picking its model, happen
 * on the Counselor page.
 */

type Installed = Connector & { id: string };

export function CounselorManage({ deskId }: { deskId: string }) {
  const now = useNow(5_000);
  const { connectors, reload } = useConnectors(deskId, 8_000);
  if (connectors === null) return <p className="text-sm text-muted">Loading…</p>;
  const mine = counselors(connectors, now).filter((c): c is Installed => !!c.id);
  if (!mine.length) {
    return (
      <section className="card px-4 py-4" aria-label="Set up your counselor">
        <CounselorSetup />
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {mine.map((c, i) => (
        <CounselorCard
          key={c.id}
          counselor={c}
          title={c.counselor_computer?.trim() || (mine.length > 1 ? `Counselor ${i + 1}` : "Your counselor")}
          pending={pendingReplacement(connectors, c.id)}
          now={now}
          onChange={reload}
        />
      ))}
      <details className="card px-4 py-3" data-testid="counselor-add">
        <summary className="cursor-pointer font-medium">Add it to another computer</summary>
        <p className="mt-2 mb-3 text-sm text-muted">
          Run it on as many computers as you like: each question goes to one of them, and if that computer goes to sleep, another
          one picks it up. Do this on the computer you want to add.
        </p>
        <CounselorSetup />
      </details>
      <p className="text-sm text-muted">
        Talk to it and choose its model (for every computer) on the{" "}
        <Link href="/desk/counselor" className="underline underline-offset-2">
          Counselor page
        </Link>
        .
      </p>
    </div>
  );
}

function CounselorCard({
  counselor: c,
  title,
  pending,
  now,
  onChange,
}: {
  counselor: Installed;
  title: string;
  /** An update downloaded for this counselor and not started yet. */
  pending: Connector | null;
  now: number;
  onChange: () => Promise<unknown>;
}) {
  const platform = usePlatform();
  // Updating means running a new setup on the computer the counselor runs on, from its browser.
  const theirs = counselorPlatform(c);
  const here = platform === theirs ? theirs : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const id = c.id;
  const on = isCounselor(c, now);
  const paused = !!c.counselor_paused;
  const doing = on ? activityText(c, now) : null;
  const lastSeen = c.counselor_at ? whenLabel(c.counselor_at, now || timeOf(c.counselor_at)) : "";
  // A database without migration 20261002: no pause or removal to offer yet.
  const legacy = c.counselor_version === undefined;
  const outdated = isOutdated(c);
  const disconnect = () => run(() => revokeConnectorLink(id));

  return (
    <section className="card flex flex-col gap-4 px-4 py-4" aria-label={title} data-testid="counselor-card">
      <div>
        <h3 className="font-medium">{title}</h3>
        {c.counselor_version && (
          <p className="text-xs text-muted" data-testid="counselor-about">
            {theirs === "mac" ? "Mac" : "Windows"} · version {c.counselor_version.split("-")[0]}
          </p>
        )}
        <p
          data-testid="counselor-state"
          className={`mt-1 flex items-center gap-1.5 text-sm ${on && !paused ? "text-accent" : paused ? "text-warn" : "text-muted"}`}
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on && !paused ? "bg-accent" : paused ? "bg-warn" : "bg-line"}`} />
          {!on ? `Off · last seen ${lastSeen}` : paused ? "Paused" : doing ? `On · ${doing}` : "On · waiting for your next question"}
        </p>
        {!on && <p className="mt-1 text-xs text-muted">It runs on the computer you set it up on, and starts whenever you sign in there.</p>}
      </div>

      {pending ? (
        <div className="flex flex-col gap-2 text-sm" data-testid="counselor-update-pending">
          <p>
            Update downloaded. Run the file on the computer your counselor runs on; this one keeps answering until the new one starts,
            and the new one carries on the same conversation.
          </p>
          <InstallSteps platform={theirs} />
          <div>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => revokeConnectorLink(pending.id!))}>
              Cancel the update
            </button>
          </div>
        </div>
      ) : (
        outdated && (
          <div className="rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm" data-testid="counselor-update">
            <p className="mb-2">
              A newer counselor is ready: it shows this computer&apos;s name here, and shares the questions with your counselor on
              your other computers.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !here}
              onClick={() =>
                void run(async () => {
                  if (!here) return;
                  const r = await updateCounselorLink(id);
                  if (r.error || !r.token) throw new Error(r.error ?? "No link was made.");
                  await downloadInstaller(r.token, here);
                })
              }
            >
              Update the counselor
            </button>
            {platform !== null && !here && (
              <p className="mt-1 text-xs text-muted">Open this page on the {theirs === "mac" ? "Mac" : "Windows PC"} this counselor runs on to update it.</p>
            )}
          </div>
        )
      )}

      {c.essay_access !== undefined && (
        <ConnectorPermissions id={id} label="your counselor" essays={asEssayAccess(c.essay_access)} manage={c.can_manage !== false} />
      )}

      {c.counselor_remove ? (
        <div className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm" data-testid="counselor-removing">
          <p>{on ? "Removing itself from your computer…" : "It will remove itself from your computer the next time that computer is on."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setCounselorRemove(id, false))}>
              Keep it
            </button>
            <ConfirmButton
              label="Just disconnect it"
              confirmLabel="Disconnect"
              question="Disconnect it now? Its files stay on that computer until you delete them."
              onConfirm={disconnect}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {!legacy && (
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setCounselorPaused(id, !paused))}>
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          {legacy || outdated ? (
            <ConfirmButton
              label="Turn off"
              confirmLabel="Turn off"
              question="Turn it off? This older counselor can't delete itself: update it first to remove it completely, or delete its folder yourself (AppData\Local\ApplicationDesk\Counselor on Windows; Library/Application Support/AverageApp/Counselor in your home folder on a Mac)."
              onConfirm={disconnect}
            />
          ) : (
            <ConfirmButton
              label="Remove from computer"
              confirmLabel="Remove"
              question="Remove the counselor from your computer? It stops, deletes its files and its conversation, and disconnects. You can set up a new one any time."
              onConfirm={() => run(() => setCounselorRemove(id, true))}
            />
          )}
        </div>
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
