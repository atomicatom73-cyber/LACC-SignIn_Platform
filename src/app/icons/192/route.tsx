import { renderAppIcon } from "@/lib/appIcon";

// Android / Chrome PWA home-screen icon (standard "any" purpose).
export function GET() {
  return renderAppIcon(192);
}
