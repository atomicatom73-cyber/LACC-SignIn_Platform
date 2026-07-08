import { renderAppIcon } from "@/lib/appIcon";

// Large PWA icon — splash screens and high-density home screens ("any").
export function GET() {
  return renderAppIcon(512);
}
