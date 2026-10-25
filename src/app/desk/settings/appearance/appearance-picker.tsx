"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  ESSAY_FONTS,
  ESSAY_SIZES,
  readAppearance,
  THEMES,
  type Appearance,
} from "@/lib/appearance";

// The choice lives in localStorage; this page and any other tab hear when it changes.
const CHANGED = "desk:appearance";
const subscribe = (on: () => void) => {
  window.addEventListener(CHANGED, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(CHANGED, on);
    window.removeEventListener("storage", on);
  };
};
// A string, so the same choice is the same snapshot.
const snapshot = () => JSON.stringify(readAppearance());
const serverSnapshot = () => JSON.stringify(DEFAULT_APPEARANCE);

export function AppearancePicker() {
  const now = JSON.parse(useSyncExternalStore(subscribe, snapshot, serverSnapshot)) as Appearance;
  const set = (change: Partial<Appearance>) => {
    applyAppearance({ ...now, ...change });
    window.dispatchEvent(new Event(CHANGED));
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="label">Colors</h3>
        <div role="radiogroup" aria-label="Colors" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Choice on={now.theme === "system"} onPick={() => set({ theme: "system" })} testid="theme-system">
            <Split />
            <span>
              <span className="block text-sm font-medium">Match my device</span>
              <span className="block text-xs text-muted">Paper by day, Ink when your device is dark</span>
            </span>
          </Choice>
          {THEMES.map((t) => (
            <Choice key={t.id} on={now.theme === t.id} onPick={() => set({ theme: t.id })} testid={`theme-${t.id}`}>
              <Swatch colors={t.swatch} />
              <span>
                <span className="block text-sm font-medium">
                  {t.name}
                  <span className="ml-1.5 text-xs font-normal text-muted">{t.dark ? "dark" : "light"}</span>
                </span>
                <span className="block text-xs text-muted">{t.hint}</span>
              </span>
            </Choice>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">Essay text size</h3>
        <div role="radiogroup" aria-label="Essay text size" className="flex flex-wrap gap-2">
          {ESSAY_SIZES.map((s) => (
            <Choice key={s.id} on={now.essaySize === s.id} onPick={() => set({ essaySize: s.id })} testid={`essay-size-${s.id}`}>
              <span className="text-sm">{s.name}</span>
            </Choice>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">Essay font</h3>
        <div role="radiogroup" aria-label="Essay font" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ESSAY_FONTS.map((f) => (
            <Choice key={f.id} on={now.essayFont === f.id} onPick={() => set({ essayFont: f.id })} testid={`essay-font-${f.id}`}>
              <span>
                <span className={`block text-base ${f.id === "serif" ? "font-serif" : ""}`}>{f.name}</span>
                <span className="block text-xs text-muted">{f.hint}</span>
              </span>
            </Choice>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label">Preview</h3>
        <div className="card essay px-5 py-4">
          <div className="ProseMirror [&>p:last-child]:mb-0" style={{ minHeight: 0 }} aria-hidden data-testid="appearance-preview">
            <p>
              The summer I rebuilt my grandmother&apos;s radio, I learned that most things can be fixed if you are patient
              enough to take them apart.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Choice({ on, onPick, testid, children }: { on: boolean; onPick: () => void; testid: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-testid={testid}
      onClick={onPick}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        on ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** A theme in small: its ground, a panel with a line of text, and its accent. */
function Swatch({ colors: [bg, panel, ink, accent] }: { colors: [string, string, string, string] }) {
  return (
    <span aria-hidden className="relative block h-10 w-14 shrink-0 overflow-hidden rounded-md border border-line" style={{ background: bg }}>
      <span className="absolute inset-x-1.5 top-1.5 bottom-0 rounded-t-sm" style={{ background: panel }}>
        <span className="absolute left-1.5 top-1.5 h-1 w-6 rounded-full" style={{ background: ink }} />
        <span className="absolute left-1.5 top-3.5 h-1 w-4 rounded-full opacity-50" style={{ background: ink }} />
        <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
      </span>
    </span>
  );
}

/** Match my device: Paper and Ink, half and half. */
function Split() {
  const [paper, ink] = [THEMES.find((t) => t.id === "paper")!, THEMES.find((t) => t.id === "ink")!];
  return (
    <span aria-hidden className="relative block h-10 w-14 shrink-0 overflow-hidden rounded-md border border-line">
      <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: paper.swatch[0] }} />
      <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: ink.swatch[0] }} />
      <span className="absolute bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full" style={{ background: paper.swatch[3] }} />
    </span>
  );
}
