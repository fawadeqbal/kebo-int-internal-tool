import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kebo RFQ Desk", template: "%s · Kebo RFQ Desk" },
  description: "Kebo's internal desk for buyer RFQs, quotations and invoices",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
