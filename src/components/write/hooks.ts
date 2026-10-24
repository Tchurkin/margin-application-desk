"use client";

/*
 * Small browser-state hooks for the Write workspace. Layout choices are per browser, so they
 * live in localStorage; every access is guarded, and when storage is blocked (private mode) the
 * choice still works for this visit, it just isn't remembered.
 */

import { useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePref(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Kept in memory for this visit.
  }
  listeners.forEach((f) => f());
}

function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  // Another tab changed a choice: follow it.
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** A remembered choice; null until the page is in the browser, or when nothing is stored. */
export function usePref(key: string): string | null {
  return useSyncExternalStore(
    subscribePrefs,
    () => readPref(key),
    () => null,
  );
}

/** Whether a media query matches (false while rendering on the server). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The window's width, following resizes (a typical laptop width on the server). */
export function useWindowWidth(): number {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    () => window.innerWidth,
    () => 1280,
  );
}

let now = 0;
let clock: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

/** The time, refreshed every half minute: enough for "5 min ago". */
export function useNow(): number {
  return useSyncExternalStore(
    (fn) => {
      clockListeners.add(fn);
      clock ??= setInterval(() => {
        now = Date.now();
        clockListeners.forEach((f) => f());
      }, 30_000);
      return () => {
        clockListeners.delete(fn);
        if (!clockListeners.size && clock) {
          clearInterval(clock);
          clock = null;
          now = 0;
        }
      };
    },
    () => (now ||= Date.now()),
    () => 0,
  );
}

/** Whether a key press happened while typing somewhere (then page shortcuts stay out of the way). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/**
 * Keep a scrolling box where it was across pages. Opening another piece loads a new page, which
 * builds the box again at its start: it goes back to where it was (for this tab, under `key`), and
 * if the item marked `current` would still be out of view, scrolls just enough to show it.
 */
export function useKeptScroll(box: RefObject<HTMLElement | null>, key: string, axis: "y" | "x", current: string) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const prop = axis === "y" ? "scrollTop" : "scrollLeft";
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      // Storage blocked: start at the start.
    }
    // What's inside can still be growing for a frame or two: keep at it until it fits.
    let frames = 0;
    let raf = 0;
    const settle = () => {
      if (saved) el[prop] = saved;
      if (saved && Math.abs(el[prop] - saved) > 1 && frames++ < 20) {
        raf = requestAnimationFrame(settle);
        return;
      }
      const here = el.querySelector<HTMLElement>(current);
      if (!here) return;
      const a = here.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const out = axis === "y" ? a.top < b.top || a.bottom > b.bottom : a.left < b.left || a.right > b.right;
      if (out) {
        if (axis === "y") el.scrollBy({ top: a.top < b.top ? a.top - b.top : a.bottom - b.bottom, behavior: "smooth" });
        else el.scrollBy({ left: a.left < b.left ? a.left - b.left : a.right - b.right, behavior: "smooth" });
      }
    };
    settle();
    const save = () => {
      try {
        sessionStorage.setItem(key, String(Math.round(el[prop])));
      } catch {
        // Not remembered, then.
      }
    };
    el.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", save);
    };
  }, [box, key, axis, current]);
}
