import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Document", template: "%s · RFQ Desk" } };

/**
 * Printable documents: no app shell, a grey desk around the A4 sheet on
 * screen, plain paper when printed (also how the PDF download renders them).
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#e7ebf0] pb-10 [color-scheme:light] [html[data-embedded]_&]:pt-6 print:bg-white print:pb-0">
      <style>{`@page { size: A4; margin: 14mm 14mm 18mm; } html, body { background: #e7ebf0; } @media print { html, body { background: #fff; } }`}</style>
      {/* Inside the app's viewer the viewer has the buttons: the paper's own bar hides from the first paint. */}
      <script dangerouslySetInnerHTML={{ __html: "if(self!==top)document.documentElement.setAttribute('data-embedded','')" }} />
      <main>{children}</main>
    </div>
  );
}
