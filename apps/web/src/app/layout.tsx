import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { WebVitals } from "@/components/common/web-vitals";
import { KeyboardWatch } from "@/components/common/keyboard";
import { PRODUCT_NAME } from "@/lib/product";

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Every RFQ from first message to shipped and paid: inquiries, quotations, orders and money",
  robots: { index: false, follow: false },
};

/** Android: the keyboard makes the page shorter (iPhone does not; KeyboardWatch sees to that). */
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };

/** Applies the saved theme before first paint, so there is no light flash in dark mode. */
const THEME_SCRIPT = `try{var m=localStorage.getItem("theme")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans">
        <WebVitals />
        <KeyboardWatch />
        {children}
      </body>
    </html>
  );
}
