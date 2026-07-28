import type { MetadataRoute } from "next";

/** Web app manifest — lets the kiosk iPad and phones install to the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LACC Studio",
    short_name: "LACC",
    description:
      "Los Alamos Community Ceramics — member sign-in, jobs, studio calendar, and announcements.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android launchers prefer a maskable icon; without one they shrink the
      // "any" icon inside a white rounded square instead of showing the logo.
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
