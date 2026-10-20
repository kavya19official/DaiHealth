import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DAI · Hospital readiness",
  description: "DAI synthetic hospital readiness and coordination portal",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
