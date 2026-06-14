'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SidebarNavContent } from './Sidebar';

/**
 * Mobile-only (`md:hidden`) navigation: a slim top bar with a burger that opens
 * a left slide-in drawer holding the same links as the desktop sidebar.
 *
 * Lives in the root layout as a flex child ABOVE the scrollable page column, so
 * the bar stays put while the page scrolls. The drawer itself is a fixed
 * overlay. It auto-closes on route change and on backdrop tap.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A followed link changes the path → close the drawer.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <div className="md:hidden flex items-center gap-3 h-12 shrink-0 px-4 border-b border-zinc-800 bg-zinc-950">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={open}
          className="-ml-1.5 p-1.5 text-zinc-300 hover:text-white"
        >
          <BurgerIcon />
        </button>
        <Link href="/" className="text-sm font-semibold text-zinc-100">Gen Studio</Link>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[82%] bg-zinc-950 border-r border-zinc-800 overflow-y-auto shadow-xl">
            <SidebarNavContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6"  x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
