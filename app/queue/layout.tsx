'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Breadcrumbs, BreadcrumbItem } from '../../components/Breadcrumbs';

const TABS = [
  { slug: 'active', label: 'Активные' },
  { slug: 'all',    label: 'Все'      },
  { slug: 'done',   label: 'Готовые'  },
] as const;

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = TABS.find((t) => pathname?.endsWith(`/queue/${t.slug}`));

  const crumbs: BreadcrumbItem[] = [
    { label: 'Projects', href: '/' },
    { label: 'Queue',    href: tab ? '/queue/active' : undefined },
    ...(tab ? [{ label: tab.label }] : []),
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-8 pt-3 pb-0">
          <Breadcrumbs items={crumbs} />
          <h1 className="text-xl font-semibold text-zinc-100">Очередь</h1>
          <TabsNav />
        </div>
      </div>
      <main className="p-8 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}

function TabsNav() {
  const pathname = usePathname();
  const activeSlug = TABS.find((t) => pathname?.endsWith(`/queue/${t.slug}`))?.slug ?? '';

  return (
    <div className="flex border-b border-zinc-800 -mb-px mt-3 overflow-x-auto" role="tablist">
      {TABS.map((t) => {
        const isActive = activeSlug === t.slug;
        return (
          <Link
            key={t.slug}
            href={`/queue/${t.slug}`}
            role="tab"
            aria-selected={isActive}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              isActive
                ? 'text-blue-400 border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
