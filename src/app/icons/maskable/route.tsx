import { renderAppIcon } from "@/lib/appIcon";

// Drawn once at build time and served from the CDN. GET route handlers are
// dynamic by default, and an ImageResponse render (satori + resvg) is one of the
// most CPU-hungry things this app does — every icon fetch used to redraw it.
export const dynamic = "force-static";

// Android "maskable" icon: extra dark padding so the logo stays inside the
// launcher mask's safe zone (a circle can clip a full-bleed icon's corners).
export function GET() {
  return renderAppIcon(512, 0.62);
}
