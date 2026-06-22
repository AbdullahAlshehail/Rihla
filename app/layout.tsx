import type { Metadata, Viewport } from "next";
import "./globals.css";
// Leaflet styles — required by the lazy-loaded DiscoverMap (react-leaflet +
// marker-cluster) to render tiles, markers, and cluster bubbles correctly.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

export const metadata: Metadata = {
  title: "رحلتي · Rihla",
  description: "مساعد سفر ذكي للجوال — قرّر بثوانٍ، ورتّب يومك بدقة.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "رحلتي" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // WCAG 2.1 SC 1.4.4 — users must be able to zoom up to 2x without breaking
  // content. We allow up to 5x.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0c4a63",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Preconnects shave 100-300 ms off the first map tile + first photo
            request on 4G by warming TLS before the chunks even ask for them. */}
        <link rel="preconnect" href="https://a.tile.openstreetmap.org" crossOrigin="" />
        <link rel="preconnect" href="https://b.tile.openstreetmap.org" crossOrigin="" />
        <link rel="preconnect" href="https://c.tile.openstreetmap.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://lh3.googleusercontent.com" />
        <link rel="dns-prefetch" href="https://maps.googleapis.com" />
      </head>
      <body className="font-sans min-h-dvh">{children}</body>
    </html>
  );
}
