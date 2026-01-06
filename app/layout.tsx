import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { ChatAttentionBell } from "./components/ChatAttentionBell";
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
        <div className="container">
          <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Project Control Center</div>
            <div className="muted" style={{ fontSize: 13 }}>v0 scaffold</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
              <Suspense fallback={null}>
                <ChatAttentionBell />
              </Suspense>
              <nav style={{ display: "flex", gap: 12, fontSize: 14 }}>
                <a href="/">Portfolio</a>
                <a href="/chat">Chat</a>
                <a href="/settings">Settings</a>
              </nav>
            </div>
          </header>
          {children}
        </div>
        <Suspense fallback={null}>
          <ChatWidget />
        </Suspense>
      </body>
    </html>
  );
}
