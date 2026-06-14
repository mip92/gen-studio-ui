import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";
import { MobileNav } from "../components/MobileNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gen Studio",
  description: "AI video production · LoRA pipeline · scene rendering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Desktop (md+): a flex ROW — persistent sidebar on the left, page on the
          right. Mobile: a flex COLUMN — the MobileNav top bar on top, page below.
          The Sidebar is hidden on mobile and the MobileNav bar is hidden on
          desktop, so only one nav shows per breakpoint.
          min-w-0 on the page column lets long content (queue table, long scene
          titles) shrink/scroll instead of stretching the row.
          h-screen + overflow-hidden caps the body to the viewport so the sticky
          page headers don't push the body past 100vh; vertical scroll for long
          content happens inside the page column instead. */}
      <body className="h-screen flex flex-col md:flex-row bg-zinc-950 overflow-hidden">
        <MobileNav />
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">{children}</div>
      </body>
    </html>
  );
}
