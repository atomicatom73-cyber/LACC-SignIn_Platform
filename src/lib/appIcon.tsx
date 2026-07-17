import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The studio logo composited on a white background, sized for a
 * favicon / home-screen slot. Used by the `icon` and `apple-icon` metadata
 * routes and by the manifest icon routes under `/icons/*` so every icon the
 * browser or phone picks up is the real logo, not a generated glyph.
 *
 * `logoFraction` is how much of the square canvas the logo spans; the rest is
 * white margin. The logo art already fills ~89% of its own frame, so:
 *   - iOS / favicon "any" icons can run wide (~0.88) — iOS just rounds the
 *     corners over the transparent margin.
 *   - Android "maskable" icons need a smaller fraction (~0.62) so the art
 *     stays inside the mask's ~80% safe zone and isn't clipped by a circle.
 */
export async function renderAppIcon(size: number, logoFraction = 0.88) {
  const logo = await readFile(join(process.cwd(), "public", "logo.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  const logoPx = Math.round(size * logoFraction);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={logoPx} height={logoPx} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
