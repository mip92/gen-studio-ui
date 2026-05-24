'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs, BreadcrumbItem } from '../../components/Breadcrumbs';
import { ScrollableTabs } from '../../components/ScrollableTabs';

const TABS = [
  { slug: 'active', label: 'Активные' },
  { slug: 'all',    label: 'Все'      },
  { slug: 'done',   label: 'Готовые'  },
] as const;

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = TABS.find((t) => pathname?.endsWith(`/queue/${t.slug}`));

  const crumbs: BreadcrumbItem[] = [
    { label: 'Overview', href: '/' },
    { label: 'Queue',    href: tab ? '/queue/active' : undefined },
    ...(tab ? [{ label: tab.label }] : []),
  ];

  return (
    <div className="bg-zinc-950 text-zinc-100">
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
    <ScrollableTabs
      className="mt-3"
      tabs={TABS.map((t) => ({
        href:   `/queue/${t.slug}`,
        label:  t.label,
        active: activeSlug === t.slug,
      }))}
    />
  );
}
