"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/officer", label: "Overview" },
  { href: "/officer/chores", label: "Chores" },
  { href: "/officer/members", label: "Members" },
  { href: "/officer/messages", label: "Messages" },
  { href: "/calendar", label: "Calendar" },
];

export function OfficerNav() {
  const pathname = usePathname();

  return (
    <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 text-sm font-medium">
      {TABS.map((tab) => {
        const active =
          tab.href === "/officer"
            ? pathname === "/officer"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 rounded-full px-4 py-2 transition ${
              active
                ? "bg-accent text-background"
                : "border border-border bg-surface text-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
