import { renderAppIcon } from "@/lib/appIcon";

// Favicon: the real studio logo on a white background.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return renderAppIcon(size.width);
}
