import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SessionKeeper } from "@/components/SessionKeeper";
import { InstallPrompt } from "@/components/InstallPrompt";
import { OfflineQueueSync } from "@/components/OfflineQueueSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LACC Studio",
  description:
    "Los Alamos Community Ceramics — member sign-in, jobs, calendar, and announcements",
  applicationName: "LACC Studio",
  appleWebApp: {
    capable: true,
    title: "LACC Studio",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Draw edge-to-edge on phones; safe-area padding in globals.css keeps
  // content clear of notches and home indicators.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Plain block, not a flex column: a viewport-height flex body squashes
          page shells whose min-h-dvh overrides their automatic minimum size
          (clipped navs, broken sticky). Pages manage their own height. */}
      <body className="min-h-full">
        <SessionKeeper />
        {/* Mounted app-wide, not just on the kiosk: a tablet that lost wifi
            mid-shift gets left on whatever screen it was on, and the queue
            still needs to drain from there. Renders nothing when empty. */}
        <OfflineQueueSync />
        {children}
        <InstallPrompt />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
