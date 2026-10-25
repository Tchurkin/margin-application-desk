/*
 * How the site looks, chosen in Settings > Appearance and kept per browser: a color theme, and
 * the essay's text size and font. The choice is put on <html> as data attributes (globals.css
 * reads them) before the page is first drawn, by the script in the root layout, so a page never
 * flashes the wrong colors.
 */

export type ThemeId = "system" | "paper" | "sepia" | "cloud" | "ink" | "midnight" | "contrast";
export type EssaySize = "small" | "standard" | "large";
export type EssayFont = "serif" | "sans";

export interface ThemeInfo {
  id: Exclude<ThemeId, "system">;
  name: string;
  hint: string;
  dark: boolean;
  /** For its preview: ground, panel, text, accent. */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeInfo[] = [
  { id: "paper", name: "Paper", hint: "Warm white, deep green", dark: false, swatch: ["#f7f5f0", "#ffffff", "#1d1c1a", "#2f5d50"] },
  { id: "sepia", name: "Sepia", hint: "Cream, easy on the eyes", dark: false, swatch: ["#f4ecd8", "#fbf6e9", "#2b2418", "#8a4b1f"] },
  { id: "cloud", name: "Cloud", hint: "Cool grey, blue", dark: false, swatch: ["#f3f5f8", "#ffffff", "#1a1f2b", "#2c5fa8"] },
  { id: "ink", name: "Ink", hint: "Charcoal, soft green", dark: true, swatch: ["#151514", "#1e1e1c", "#ecebe6", "#7fbfa9"] },
  { id: "midnight", name: "Midnight", hint: "Navy, bright blue", dark: true, swatch: ["#0f1420", "#171d2b", "#e6eaf2", "#8fb4ff"] },
  { id: "contrast", name: "High contrast", hint: "Black, white and yellow", dark: true, swatch: ["#000000", "#0d0d0d", "#ffffff", "#ffd84d"] },
];

export const ESSAY_SIZES: { id: EssaySize; name: string }[] = [
  { id: "small", name: "Smaller" },
  { id: "standard", name: "Standard" },
  { id: "large", name: "Larger" },
];

export const ESSAY_FONTS: { id: EssayFont; name: string; hint: string }[] = [
  { id: "serif", name: "Book", hint: "A serif, like a printed page" },
  { id: "sans", name: "Plain", hint: "A sans serif, like the rest of the site" },
];

export const APPEARANCE_KEYS = { theme: "desk:theme", essaySize: "desk:essay-size", essayFont: "desk:essay-font" } as const;

export interface Appearance {
  theme: ThemeId;
  essaySize: EssaySize;
  essayFont: EssayFont;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", essaySize: "standard", essayFont: "serif" };

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function readAppearance(): Appearance {
  const theme = read(APPEARANCE_KEYS.theme);
  const size = read(APPEARANCE_KEYS.essaySize);
  const font = read(APPEARANCE_KEYS.essayFont);
  return {
    theme: theme === "system" || THEMES.some((t) => t.id === theme) ? (theme as ThemeId) : DEFAULT_APPEARANCE.theme,
    essaySize: ESSAY_SIZES.some((s) => s.id === size) ? (size as EssaySize) : DEFAULT_APPEARANCE.essaySize,
    essayFont: ESSAY_FONTS.some((f) => f.id === font) ? (font as EssayFont) : DEFAULT_APPEARANCE.essayFont,
  };
}

/** Put a choice on the page (as data attributes on <html>). */
export function showAppearance(a: Appearance) {
  const root = document.documentElement;
  if (a.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", a.theme);
  root.setAttribute("data-essay-size", a.essaySize);
  root.setAttribute("data-essay-font", a.essayFont);
}

/** Put a choice on the page now, and keep it for next time (in this browser). */
export function applyAppearance(a: Appearance) {
  showAppearance(a);
  try {
    localStorage.setItem(APPEARANCE_KEYS.theme, a.theme);
    localStorage.setItem(APPEARANCE_KEYS.essaySize, a.essaySize);
    localStorage.setItem(APPEARANCE_KEYS.essayFont, a.essayFont);
  } catch {
    // Storage blocked: it holds for this page.
  }
}

/**
 * Run in <head> before anything is drawn: the browser's chosen theme and essay text, from
 * localStorage. Plain, self-contained JavaScript (it's inlined as a string).
 */
export const APPEARANCE_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage;var t=s.getItem("${APPEARANCE_KEYS.theme}");if(t&&t!=="system"&&${JSON.stringify(
  THEMES.map((t) => t.id),
)}.indexOf(t)>=0)d.setAttribute("data-theme",t);var z=s.getItem("${APPEARANCE_KEYS.essaySize}");if(z==="small"||z==="large")d.setAttribute("data-essay-size",z);var f=s.getItem("${APPEARANCE_KEYS.essayFont}");if(f==="sans")d.setAttribute("data-essay-font",f);}catch(e){}})();`;
