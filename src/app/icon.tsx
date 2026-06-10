import { ImageResponse } from "next/og";

// Branded favicon, generated at build time (no binary asset to maintain).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff7a45",
          color: "#0f1115",
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        LA
      </div>
    ),
    { ...size },
  );
}
