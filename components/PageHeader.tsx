'use client';

import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';
import { ScrollableTabs, ScrollableTab } from './ScrollableTabs';

/**
 * The single page-header used by every top-level view and shell in the app —
 * overview, projects, actions, queue, voices, and the project / shot /
 * character shells. One component so the breadcrumb row, title, right-hand
 * controls and optional tab strip are identical everywhere. Full-width by
 * design (no max-width cap) to match the full-width page bodies; the outer page
 * column owns horizontal overflow.
 *
 * NOT sticky — it scrolls away with the page. On a small phone this header runs
 * 120–170px (crumbs + title + actions + tab strip), which is a quarter of the
 * screen permanently spent on chrome; and pinning it was only ever needed
 * because the app used to scroll inside a fixed-height shell. Scroll up to get
 * it back.
 *
 * Anatomy (top → bottom):
 *   Breadcrumbs
 *   [ title + subtitle ] ............... [ actions ]
 *   [ below ]                    (optional full-width row, e.g. a pager)
 *   ScrollableTabs                       (optional)
 */
export interface PageHeaderProps {
  crumbs: BreadcrumbItem[];
  title: React.ReactNode;
  /** Small line under the title — an id, a one-line description, a count. */
  subtitle?: React.ReactNode;
  /** Right-aligned controls: buttons, selects, links, a status badge. */
  actions?: React.ReactNode;
  /** Tab strip rendered flush with the header's bottom border. */
  tabs?: ScrollableTab[];
  /** Extra full-width row below the title row (e.g. a pager). */
  below?: React.ReactNode;
}

export function PageHeader({ crumbs, title, subtitle, actions, tabs, below }: PageHeaderProps) {
  // With a tab strip, the tabs supply the bottom edge (they carry their own
  // border-b + -mb-px that overlaps the header border), so drop the header's
  // own bottom padding. Without tabs, pad the bottom instead.
  return (
    <header className="bg-zinc-950 border-b border-zinc-800 text-zinc-100">
      <div className={`px-4 sm:px-8 pt-3 ${tabs ? 'pb-0' : 'pb-3'}`}>
        <Breadcrumbs items={crumbs} />
        <div className="flex items-start justify-between gap-4 mt-1">
          <div className="min-w-0">
            {/* truncate: on a phone the actions block (shrink-0) can leave the
                title far less than its text width — without truncate the h1
                spills out and overlaps the actions. */}
            <h1 className="text-xl font-semibold text-zinc-100 truncate">{title}</h1>
            {subtitle != null && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
          </div>
          {actions != null && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
        {below != null && <div className="mt-2">{below}</div>}
        {tabs && <ScrollableTabs className="mt-3" tabs={tabs} />}
      </div>
    </header>
  );
}
