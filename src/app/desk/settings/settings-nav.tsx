"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_PAGES = [
  { href: "/desk/settings", label: "General" },
  { href: "/desk/settings/appearance", label: "Appearance" },
  { href: "/desk/settings/sharing", label: "Sharing" },
  { href: "/desk/settings/connectors", label: "Claude & ChatGPT" },
  { href: "/desk/settings/counselor", label: "Counselor" },
  { href: "/desk/settings/trash", label: "Trash" },
  { href: "/desk/settings/account", label: "Account" },
];

/** The settings pages: a column beside the page on wide screens, a row above it on narrow ones. */
export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {SETTINGS_PAGES.map((p) => {
          const active = path === p.href;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                  active ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:bg-panel hover:text-ink"
                }`}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
