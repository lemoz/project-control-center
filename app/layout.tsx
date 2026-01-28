import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { NavBar } from "./components/NavBar";
import { ChatWidget } from "./components/ChatWidget";

export const metadata: Metadata = {
  title: "Project Control Center",
  description: "Local-first control center for projects and AI work orders.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <NavBar />
        </Suspense>
        <div className="container">
          {children}
        </div>
        <Suspense fallback={null}>
          <ChatWidget />
        </Suspense>
      </body>
    </html>
  );
}
