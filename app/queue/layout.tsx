'use client';

import { usePathname } from 'next/navigation';
import { BreadcrumbItem } from '../../components/Breadcrumbs';
import { PageHeader } from '../../components/PageHeader';

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
      <PageHeader
        crumbs={crumbs}
        title="Очередь"
        tabs={TABS.map((t) => ({
          href:   `/queue/${t.slug}`,
          label:  t.label,
          active: tab?.slug === t.slug,
        }))}
      />
      <main className="p-4 sm:p-8">{children}</main>
    </div>
  );
}
