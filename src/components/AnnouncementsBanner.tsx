import Link from "next/link";

/**
 * The impossible-to-miss unread-announcements banner on /me. Renders nothing
 * when the inbox is clear; the shimmer/glow styles live in globals.css.
 */
export function AnnouncementsBanner({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Link
      href="/me/inbox"
      className="announce-banner flex items-center justify-between gap-3 rounded-2xl px-4 py-4 text-background transition active:scale-[0.98]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="text-2xl" aria-hidden>
          📣
        </span>
        <span>
          <span className="block text-sm font-bold uppercase tracking-wide">
            {count === 1 ? "New announcement" : `${count} new announcements`}
          </span>
          <span className="block text-xs opacity-90">
            From the officers — tap to read.
          </span>
        </span>
      </span>
      <span className="announce-badge flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-sm font-bold text-foreground">
        {count}
      </span>
    </Link>
  );
}
