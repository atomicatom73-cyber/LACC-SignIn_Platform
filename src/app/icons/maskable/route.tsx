import { renderAppIcon } from "@/lib/appIcon";

// Android "maskable" icon: extra dark padding so the logo stays inside the
// launcher mask's safe zone (a circle can clip a full-bleed icon's corners).
export function GET() {
  return renderAppIcon(512, 0.62);
}
