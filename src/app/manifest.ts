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
    background_color: "#0f1115",
    theme_color: "#0f1115",
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
