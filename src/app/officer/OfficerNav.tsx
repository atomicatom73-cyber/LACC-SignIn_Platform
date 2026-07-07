"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/roles";

const TABS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/officer", label: "Overview" },
  { href: "/officer/chores", label: "Jobs" },
  { href: "/officer/members", label: "Members" },
  {
    href: "/officer/logs",
    label: "Sign-ins",
    roles: ["president", "vice_president"],
  },
  { href: "/officer/messages", label: "Messages" },
  { href: "/calendar", label: "Calendar" },
];

export function OfficerNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    // Sticky with a solid backdrop and its own stacking context: the tabs
    // stay reachable while scrolling and nothing can render on top of them.
    // shrink-0 matters: overflow-x-auto strips the automatic flex minimum
    // size, and without it the surrounding flex columns squash the tabs into
    // a clipped sliver.
    <nav className="sticky top-0 z-20 -mx-5 mt-4 flex shrink-0 gap-2 overflow-x-auto bg-background/95 px-5 py-3 text-sm font-medium backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
      {TABS.filter((tab) => !tab.roles || tab.roles.includes(role)).map(
        (tab) => {
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
        },
      )}
    </nav>
  );
}
