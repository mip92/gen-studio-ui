'use client';

import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  /** Last item should omit href — it renders as the current page (no link). */
  href?: string;
}

/**
 * Single source of truth for breadcrumb appearance across the app. Pages and
 * layouts assemble an `items` array — first crumb is the root anchor, last is
 * the current page (no href, lighter color). All separators, spacing, and
 * hover behaviour live here so changing the look means editing one file.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav
      className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5 flex-wrap"
      aria-label="Breadcrumb"
    >
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-zinc-700">/</span>}
            {it.href && !isLast ? (
              <Link href={it.href} className="hover:text-zinc-300">{it.label}</Link>
            ) : (
              <span className={isLast ? 'text-zinc-300' : ''}>{it.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
