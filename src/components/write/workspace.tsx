"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clampSide, nudgeSide, parseTool, parseWidth, PREF, SIDE_DEFAULT, SIDE_MIN, sideMax, type Tool } from "@/lib/write/layout";
import { isTyping, useKeptScroll, useMedia, usePref, useWindowWidth, writePref } from "./hooks";
import { CloseIcon } from "./icons";

export interface ToolDef {
  id: Tool;
  label: string;
  /** Tooltip, with the shortcut if there is one. */
  hint: string;
  icon: ReactNode;
}

/** Arrow keys move between the buttons of a toolbar. */
export function moveFocusInToolbar(e: React.KeyboardEvent<HTMLElement>, keys: string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
  items[(i + (back ? -1 : 1) + items.length) % items.length].focus();
}

/**
 * The Write page: a strip of tools, a side panel for the chosen tool, a grip to resize it, and
 * the editor. Clicking the open tool folds the panel away; clicking any tool brings it back.
 * The tool, width and folded state are remembered per browser. On narrow screens the panel is
 * a drawer over the editor instead.
 */
export function Workspace({
  tools,
  title,
  renderPanel,
  children,
}: {
  tools: ToolDef[];
  title: (tool: Tool) => string;
  renderPanel: (tool: Tool) => ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const narrow = useMedia("(max-width: 1023.98px)");
  const windowWidth = useWindowWidth();
  const storedTool = parseTool(usePref(PREF.tool));
  const storedWidth = parseWidth(usePref(PREF.sideWidth));
  const folded = usePref(PREF.folded) === "1";
  const tool: Tool = tools.some((t) => t.id === storedTool) ? storedTool : "files";
  const [drawer, setDrawer] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; w: number } | null>(null);
  const width = drag ?? clampSide(storedWidth, windowWidth);
  const shown = narrow ? drawer : !folded;

  const pick = (id: Tool) => {
    if (narrow) {
      if (drawer && tool === id) setDrawer(false);
      else {
        writePref(PREF.tool, id);
        setDrawer(true);
      }
      return;
    }
    if (!folded && tool === id) writePref(PREF.folded, "1");
    else {
      writePref(PREF.tool, id);
      writePref(PREF.folded, "0");
    }
  };

  // The workspace fills the window below the header, and each column scrolls on its own.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const top = `${Math.max(0, el.getBoundingClientRect().top + window.scrollY)}px`;
      if (el.style.getPropertyValue("--ws-top") !== top) el.style.setProperty("--ws-top", top);
    };
    measure();
    // The header's font can land after the first paint, and the header can wrap: either changes
    // how far down the workspace starts.
    void document.fonts?.ready.then(measure);
    const resized = new ResizeObserver(measure);
    resized.observe(document.body);
    document.querySelectorAll("header").forEach((h) => resized.observe(h));
    window.addEventListener("resize", measure);
    return () => {
      resized.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // On a wide screen nothing but the columns scrolls. A field taking focus, or the editor keeping
  // its caret in view, can still make the browser scroll the page or the workspace itself (even
  // with overflow hidden), which slides everything up and leaves blank page below: put it back.
  useEffect(() => {
    const el = root.current;
    if (narrow || !el) return;
    const pinPage = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    const pinSelf = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };
    pinPage();
    pinSelf();
    window.addEventListener("scroll", pinPage, { passive: true });
    el.addEventListener("scroll", pinSelf, { passive: true });
    return () => {
      window.removeEventListener("scroll", pinPage);
      el.removeEventListener("scroll", pinSelf);
    };
  }, [narrow]);

  // Ctrl/Cmd+\ folds or unfolds the panel; Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        if (narrow) setDrawer((d) => !d);
        else writePref(PREF.folded, folded ? "0" : "1");
      } else if (e.key === "Escape" && narrow && drawer && !isTyping(e)) setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, folded, drawer]);

  const endDrag = (x: number) => {
    if (!start.current) return;
    const w = clampSide(start.current.w + x - start.current.x, windowWidth);
    start.current = null;
    setDrag(null);
    writePref(PREF.sideWidth, String(w));
  };

  return (
    <div
      ref={root}
      data-write-workspace
      style={{ "--side-w": `${width}px` } as CSSProperties}
      className={`flex flex-col lg:grid lg:h-[calc(100dvh-var(--ws-top,3.1rem))] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${
        shown && !narrow ? "lg:grid-cols-[46px_var(--side-w)_7px_minmax(0,1fr)]" : "lg:grid-cols-[46px_minmax(0,1fr)]"
      }`}
    >
      <div
        role="toolbar"
        aria-label="Tools"
        aria-orientation={narrow ? "horizontal" : "vertical"}
        onKeyDown={(e) => moveFocusInToolbar(e)}
        className="sticky top-0 z-20 flex gap-1 border-b border-line bg-panel px-2 py-1 lg:static lg:flex-col lg:items-center lg:border-r lg:border-b-0 lg:px-0 lg:py-2"
      >
        {tools.map((t) => {
          const active = shown && tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-pressed={active}
              aria-controls={active ? "side-panel" : undefined}
              title={t.hint}
              onClick={() => pick(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm lg:h-9 lg:w-9 lg:justify-center lg:p-0 ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg hover:text-ink"
              }`}
            >
              {t.icon}
              <span className="lg:sr-only" aria-hidden>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {shown && narrow && <div className="fixed inset-0 z-30 bg-ink/30" aria-hidden onClick={() => setDrawer(false)} />}
      {shown && (
        <aside
          id="side-panel"
          aria-label="Side panel"
          className={
            narrow
              ? "fixed inset-y-0 left-0 z-40 flex w-[min(22rem,88vw)] flex-col bg-panel shadow-xl"
              : "flex min-h-0 flex-col bg-panel max-lg:hidden"
          }
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h2 className="truncate text-sm font-medium">{title(tool)}</h2>
            {narrow && (
              <button type="button" className="rounded p-1 text-muted hover:text-ink" aria-label="Close the side panel" onClick={() => setDrawer(false)}>
                <CloseIcon />
              </button>
            )}
          </div>
          <PanelScroll tool={tool}>{renderPanel(tool)}</PanelScroll>
        </aside>
      )}
      {shown && !narrow && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side panel"
          aria-valuemin={SIDE_MIN}
          aria-valuemax={sideMax(windowWidth)}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize (arrow keys work too). Double-click to reset."
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, w: width };
            setDrag(width);
          }}
          onPointerMove={(e) => {
            if (start.current) setDrag(clampSide(start.current.w + e.clientX - start.current.x, windowWidth));
          }}
          onPointerUp={(e) => endDrag(e.clientX)}
          onPointerCancel={(e) => endDrag(e.clientX)}
          onDoubleClick={() => writePref(PREF.sideWidth, String(SIDE_DEFAULT))}
          onKeyDown={(e) => {
            const w = nudgeSide(width, e.key, e.shiftKey, windowWidth);
            if (w === null) return;
            e.preventDefault();
            writePref(PREF.sideWidth, String(w));
          }}
          className="group relative hidden cursor-col-resize touch-none border-l border-line outline-none hover:bg-accent-soft focus-visible:bg-accent-soft lg:block"
        >
          <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
      )}

      <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain" data-write-scroll>
        {children}
      </div>
    </div>
  );
}

/**
 * The side panel's scrolling body: it keeps its place, for each tool, when another piece is opened
 * (a new page), and shows the piece just opened.
 */
function PanelScroll({ tool, children }: { tool: Tool; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useKeptScroll(box, `desk:panel-scroll:${tool}`, "y", "[aria-current='page']");
  return (
    <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {children}
    </div>
  );
}
