import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";
import { MobileNav } from "../components/MobileNav";
import { getProjects } from "../lib/projects";
import { LiveEventsProvider } from "../lib/liveEvents";

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
};

// Deliberately minimal: no maximumScale lock. The page scrolls as an ordinary
// document now (see <body> below), so pinch-zoom is a harmless escape hatch
// rather than the only way to reach content the shell had pushed off-screen —
// and locking it out is what made a mis-laid-out page unusable on a phone.
// Auto-zoom-on-focus is prevented at the source instead: form controls are
// ≥16px on coarse pointers (globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      {/* Desktop (md+): a flex ROW — persistent sidebar on the left, page on the
          right. Mobile: a flex COLUMN — the MobileNav top bar on top, page below.
          The Sidebar is hidden on mobile and the MobileNav bar is hidden on
          desktop, so only one nav shows per breakpoint.

          THE PAGE SCROLLS AS AN ORDINARY DOCUMENT. There is no viewport-height
          cap and no inner scroll container — the body simply grows with its
          content. The previous shell (h-dvh + overflow-hidden + an overflow-y
          page column) is what made the app unusable on an iPhone: the inner
          scroller regularly refused to reach its own end, so whatever sat at the
          bottom of a page — the queue pager, most of all — was unreachable
          without pinch-zooming out. A plain document scroll cannot land in that
          state, and it gets the browser's own behaviours for free: the address
          bar collapses to give back screen height, and scroll position is
          restored on back/forward.

          min-w-0 on the page column lets long content (queue table, long scene
          titles) shrink or scroll inside its own box instead of stretching the
          row; overflow-x-hidden keeps an oversized child from making the WHOLE
          document pan sideways. */}
      <body className="min-h-dvh flex flex-col md:flex-row bg-zinc-950">
        {/* One websocket for the whole tab, feeding every live view. Mounted
            here so it survives navigation between pages instead of being torn
            down and rebuilt per route. Opens only while the tab is visible and
            something actually cares — see lib/liveEvents.tsx. */}
        <LiveEventsProvider>
          <MobileNav projects={projects} />
          <Sidebar projects={projects} />
          <div className="flex-1 min-w-0 overflow-x-hidden">{children}</div>
        </LiveEventsProvider>
      </body>
    </html>
  );
}
