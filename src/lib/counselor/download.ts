import { supabaseEnv } from "@/lib/supabase/env";
import { counselorInstaller, INSTALLER_NAME } from "./installer";

export type InstallerPlatform = "windows" | "mac";

/**
 * Build the Windows counselor's setup file for a connector token and hand it to the browser as a
 * download. The token never leaves this browser except inside the file.
 */
export function downloadInstaller(token: string) {
  const { url, key } = supabaseEnv();
  const config = { site: window.location.origin, supabaseUrl: url, supabaseKey: key, token };
  const href = URL.createObjectURL(new Blob([counselorInstaller(config)], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = INSTALLER_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * The Mac counselor's setup: one line to paste into Terminal, which fetches the setup and runs
 * it (src/app/api/counselor/[token]/setup). "bash -c" rather than "| bash", so what the setup
 * asks (signing in to Claude) reads the keyboard, not the rest of the script.
 */
export function macSetupCommand(token: string, site: string = window.location.origin): string {
  return `/bin/bash -c "$(curl -fsSL '${site}/api/counselor/${token}/setup')"`;
}
