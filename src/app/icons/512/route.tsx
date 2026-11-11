import { renderAppIcon } from "@/lib/appIcon";

// Drawn once at build time and served from the CDN. GET route handlers are
// dynamic by default, and an ImageResponse render (satori + resvg) is one of the
// most CPU-hungry things this app does — every icon fetch used to redraw it.
export const dynamic = "force-static";

// Large PWA icon — splash screens and high-density home screens ("any").
export function GET() {
  return renderAppIcon(512);
}
