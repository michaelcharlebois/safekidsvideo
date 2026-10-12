import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeKidsVideo",
  description: "Know exactly what's in it before your kid watches it.",
};

export const viewport: Viewport = { themeColor: "#fbf7f0", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
