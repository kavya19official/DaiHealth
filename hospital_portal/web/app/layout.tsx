import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "./mobile.css";
import Script from "next/script";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#6229b8",
};
export const metadata: Metadata = {
  title: "DAI · Hospital readiness",
  manifest: "/dai.webmanifest",
  appleWebApp: { title: "DaiHealth" },
  icons: { apple: "/assets/dai-app-192.png" },
  description: "DAI synthetic hospital readiness and coordination portal",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<link rel="stylesheet" href={`${process.env.NEXT_PUBLIC_DAI_BASE_PATH || ""}/daya/i18n.css?v=app-4`} /><Script src={`${process.env.NEXT_PUBLIC_DAI_BASE_PATH || ""}/daya/js/i18n.js?v=names-5`} strategy="afterInteractive" /><Script src={`${process.env.NEXT_PUBLIC_DAI_BASE_PATH || ""}/daya/js/care-chatbot.js?v=daya-3d-1`} strategy="lazyOnload" /><Script src={`${process.env.NEXT_PUBLIC_DAI_BASE_PATH || ""}/daya/js/demo-guide.js?v=1`} strategy="afterInteractive" /></body>
    </html>
  );
}
