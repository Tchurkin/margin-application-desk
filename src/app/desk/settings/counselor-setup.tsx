"use client";
import { useState, useSyncExternalStore } from "react";
import { downloadInstaller, type InstallerPlatform } from "@/lib/counselor/download";
import { WATCH_PHRASE } from "@/lib/bridge/watchers";
import { INSTALLER_NAME } from "@/lib/counselor/installer";
import { MAC_INSTALLER_NAME, MAC_ZIP_NAME } from "@/lib/counselor/mac-installer";
import type { EssayAccess } from "@/lib/domain/share";
import { createCounselorLink } from "../connector-actions";
import { PermissionFields } from "./connector-creator";

export type Platform = InstallerPlatform | "other";

/** The kind of computer this browser is on, as the counselor sees it (an iPad says it's a Mac, but has a touch screen). */
export function platformOf(): Platform {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints < 2) return "mac";
  return "other";
}

/** The platform, once the page is in the browser (null while it's rendered on the server). */
export function usePlatform(): Platform | null {
  return useSyncExternalStore(
    () => () => {},
    platformOf,
    () => null,
  );
}

/** What to do with the downloaded file. */
export function InstallSteps({ platform }: { platform: InstallerPlatform }) {
  if (platform === "mac") {
    return (
      <ol className="list-decimal rounded-md border border-accent bg-accent-soft py-3 pr-3 pl-8 text-sm" data-testid="counselor-steps">
        <li>
          In your Downloads folder, double-click <span className="font-medium">{MAC_INSTALLER_NAME}</span>. (If you see{" "}
          <span className="font-medium">{MAC_ZIP_NAME}</span> instead, double-click that first.)
        </li>
        <li>Your Mac says it can&apos;t open it. That&apos;s expected: click Done or Cancel (not Move to Trash).</li>
        <li>
          Open System Settings → Privacy & Security and scroll down to where it says the file was blocked. Click Open Anyway, then
          Open Anyway (or Open) in the box that appears, and enter your Mac&apos;s password if it asks. (It&apos;s a script this site
          wrote for you.)
        </li>
        <li>
          A Terminal window sets everything up by itself, with nothing to type. If Claude Code isn&apos;t on your Mac yet, it asks to
          install it (a minute or two), then opens your browser so you can sign in to Claude: sign in and click Authorize.
        </li>
        <li>
          Wait for “Your counselor is on.” If your Mac says Background Items Added, that&apos;s your counselor: leave it on.
        </li>
        <li>That&apos;s it. Ask anything on your desk and the answer shows up there, now and every time you log in.</li>
      </ol>
    );
  }
  return (
    <ol className="list-decimal rounded-md border border-accent bg-accent-soft py-3 pr-3 pl-8 text-sm" data-testid="counselor-steps">
      <li>
        Open the downloaded file, <span className="font-medium">{INSTALLER_NAME}</span>. If Windows warns you, choose More info → Run
        anyway (it&apos;s a script this site wrote for you).
      </li>
      <li>
        If Claude Code isn&apos;t on this computer yet, it asks to install it (a minute or two, no password), then opens your browser so
        you can sign in to Claude: sign in and click Authorize.
      </li>
      <li>Wait for “Your counselor is on.”</li>
      <li>That&apos;s it. Ask anything on your desk and the answer shows up there, now and every time you sign in.</li>
    </ol>
  );
}

const LABEL: Record<InstallerPlatform, string> = { windows: "Download the counselor for Windows", mac: "Download the counselor for Mac" };

/**
 * Set up Claude Code on this computer as the student's counselor: one download, run once. See
 * src/lib/counselor/installer.ts (Windows) and mac-installer.ts for what the file does.
 */
export function CounselorSetup({ withPermissions = true }: { withPermissions?: boolean }) {
  const platform = usePlatform();
  const [essays, setEssays] = useState<EssayAccess>("edit");
  const [manage, setManage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<InstallerPlatform | null>(null);
  // This computer's installer; on anything else (or before the page knows), both.
  const offered: InstallerPlatform[] = platform === "windows" || platform === "mac" ? [platform] : ["windows", "mac"];

  async function download(target: InstallerPlatform) {
    setBusy(true);
    setError(null);
    try {
      const r = await createCounselorLink(essays, manage);
      if (r.error || !r.token) throw new Error(r.error ?? "No link was made.");
      await downloadInstaller(r.token, target);
      setDone(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="counselor-setup">
      {withPermissions && (
        <PermissionFields idPrefix="counselor" essays={essays} manage={manage} onEssays={setEssays} onManage={setManage} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {offered.map((p) => (
          <button key={p} type="button" className="btn btn-primary" disabled={busy} onClick={() => void download(p)}>
            {busy ? "Preparing…" : LABEL[p]}
          </button>
        ))}
        {platform === "other" && (
          <span className="text-xs text-warn">
            The counselor runs on a Windows or Mac computer: set it up there. Anywhere else, use a Claude chat with “{WATCH_PHRASE}”.
          </span>
        )}
      </div>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {done && <InstallSteps platform={done} />}
    </div>
  );
}
