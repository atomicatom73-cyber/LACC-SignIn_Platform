import { renderAppIcon } from "@/lib/appIcon";

// Home-screen icon for iOS "Add to Home Screen" (iOS rounds the corners
// itself; the solid background keeps transparency from turning black).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(size.width);
}
