import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";
import { MobileNav } from "../components/MobileNav";
import { getProjects } from "../lib/projects";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetch the project list once, server-side. React.cache dedupes this with the
  // /projects pages and the per-project layout, so the whole render shares one
  // backend round-trip. Passed down as a prop → the nav has data on first paint
  // (no client "Loading…" flash, no per-mount fetch).
  const projects = await getProjects();

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
          content happens inside the page column instead. h-dvh (dynamic viewport
          height) overrides h-screen on browsers that support it so the iOS/iPadOS
          Safari address bar collapsing doesn't leave the shell taller than the
          visible area.
          The page column needs min-h-0 (not just min-w-0): on mobile the body is
          a flex COLUMN, and a flex item defaults to min-height:auto, which lets it
          grow to its full content height instead of shrinking to the leftover
          viewport. Without min-h-0 the column's overflow-y-auto never engages, the
          content overflows the overflow-hidden body, and iOS Safari refuses to
          scroll until you pinch-zoom to force a re-layout. min-h-0 makes the
          column cap at the available height so its own scroller does the work. */}
      <body className="h-screen h-dvh flex flex-col md:flex-row bg-zinc-950 overflow-hidden">
        <MobileNav projects={projects} />
        <Sidebar projects={projects} />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden">{children}</div>
      </body>
    </html>
  );
}
