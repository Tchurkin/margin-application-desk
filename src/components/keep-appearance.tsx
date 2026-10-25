"use client";

import { useLayoutEffect } from "react";
import { readAppearance, showAppearance } from "@/lib/appearance";

/*
 * The root layout's script puts the chosen appearance on <html> before the first paint. In
 * development React's Strict Mode remounts once and clears attributes it doesn't manage; this puts
 * them back before paint. In production it changes nothing.
 */
export function KeepAppearance() {
  useLayoutEffect(() => showAppearance(readAppearance()), []);
  return null;
}
