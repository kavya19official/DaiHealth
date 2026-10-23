import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
export const metadata: Metadata = {
  title: "DAI · Hospital readiness",
  description: "DAI synthetic hospital readiness and coordination portal",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<Script src={`${process.env.NEXT_PUBLIC_DAI_BASE_PATH || ""}/daya/js/care-chatbot.js?v=daya-3d-1`} strategy="lazyOnload" /></body>
    </html>
  );
}
