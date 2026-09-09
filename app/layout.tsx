import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import ThemeScript from "@/components/ThemeScript";
import AppleSplashLinks from "@/components/AppleSplashLinks";
// Leaflet styles are imported INSIDE DiscoverMap.tsx (client, dynamic-imported)
// so they don't ship in the global CSS for Now/Plan/Bookings/Login.

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
        {/* Set the dark class before first paint — no light→dark flash. */}
        <ThemeScript />
        {/* iOS launch images — kills the white flash when opened from the
            home screen, so the installed app boots like a native one. */}
        <AppleSplashLinks />
        {/* Preconnects shave 100-300 ms off the first map tile + first photo
            request on 4G by warming TLS before the chunks even ask for them.
            Tiles come from Carto Voyager (basemaps.cartocdn.com via a/b/c/d
            subdomains) — NOT from openstreetmap.org. */}
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://b.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://d.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://lh3.googleusercontent.com" />
        <link rel="dns-prefetch" href="https://maps.googleapis.com" />
      </head>
      <body className="font-sans min-h-dvh">
        {children}
        {/* Offline PWA shell — registers public/sw.js after window load. */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
