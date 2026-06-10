import { ImageResponse } from "next/og";

// Home-screen icon for iOS "Add to Home Screen" (iOS rounds the corners itself).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 92,
          fontWeight: 700,
          letterSpacing: -3,
        }}
      >
        LA
      </div>
    ),
    { ...size },
  );
}
